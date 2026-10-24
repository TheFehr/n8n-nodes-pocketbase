import {
  DeclarativeRestApiSettings,
  IDataObject,
  IExecutePaginationFunctions,
  IExecuteSingleFunctions,
  IHttpRequestOptions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  NodeOperationError,
} from "n8n-workflow";
import type { Readable } from "node:stream";
import { prepareRequestBody } from "./RequestBodyFunctions";

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function parseJwtExpiry(jwtToken: string): number {
  try {
    const [, payload] = jwtToken.split(".");
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function _resetTokenCacheForTesting(): void {
  tokenCache.clear();
}

export async function fetchPocketbaseToken(
  httpRequest: (options: IHttpRequestOptions) => Promise<unknown>,
  url: string,
  username: string,
  password: string,
): Promise<string> {
  const cacheKey = `${url}::${username}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAtMs - 60_000) {
    return cached.token;
  }
  const { token } = (await httpRequest({
    method: "POST",
    url: `${url}/api/collections/_superusers/auth-with-password`,
    body: { identity: username, password },
  })) as { token: string };
  tokenCache.set(cacheKey, { token, expiresAtMs: parseJwtExpiry(token) });
  return token;
}

export async function authenticatePreSend(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const credentials = await this.getCredentials("pocketbaseHttpApi");
  const url = (credentials.url as string).replace(/\/$/, "");
  const token = await fetchPocketbaseToken(
    (opts) => this.helpers.httpRequest(opts),
    url,
    credentials.username as string,
    credentials.password as string,
  );
  requestOptions.headers = { ...requestOptions.headers, Authorization: token };
  return requestOptions;
}

export async function recordViewPreSendAction(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  this.logger.debug(
    `Request URL: ${requestOptions.url} | ${JSON.stringify(requestOptions.qs ?? {})}`,
  );
  return requestOptions;
}

/**
 * Placeholder for future post-receive processing.
 * Currently required for declarative API registration.
 */
export async function recordViewPostReceiveAction(
  this: IExecuteSingleFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
  return items;
}

export async function recordPreSendAction(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  return await prepareRequestBody.call(this, requestOptions);
}

export const recordUpdatePreSendAction = recordPreSendAction;
export const recordCreatePreSendAction = recordPreSendAction;

const FULL_LIST_PER_PAGE = 1000;

function readPerPage(responseBody: IDataObject): number {
  const { perPage } = responseBody;
  if (typeof perPage !== "number" || !Number.isSafeInteger(perPage) || perPage < 1) {
    throw new Error("Missing or invalid perPage in PocketBase response");
  }
  return perPage;
}

export async function pagination(
  this: IExecutePaginationFunctions,
  requestOptions: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
  const allIsActive = this.getNodeParameter("parameters.allElements", false) as boolean;
  const executions: INodeExecutionData[] = [];
  let page: number = this.getNodeParameter("parameters.page", 1) as number;

  requestOptions.options ??= {};
  requestOptions.options.qs ??= {};

  requestOptions.options.qs.skipTotal = true;
  if (allIsActive) {
    requestOptions.options.qs.perPage ??= FULL_LIST_PER_PAGE;
  }

  let hasMore = true;
  while (hasMore) {
    requestOptions.options.qs.page = page;
    const responseData = await this.makeRoutingRequest(requestOptions);
    if (!responseData || responseData.length === 0) {
      // Empty response from the routing request itself (e.g. timeout or empty array)
      return executions;
    }
    const responseBody = responseData?.[0]?.json as IDataObject;

    if (!responseBody || typeof responseBody !== "object") {
      throw new Error("Invalid response from PocketBase");
    }

    const resPage = Number(responseBody.page);
    if (!Number.isFinite(resPage)) {
      // If page is missing, it might not be a paginated response (e.g. error or different endpoint)
      // If we already have some items, just return them with a warning.
      if (executions.length > 0) {
        this.logger.warn("Received invalid page number in response; returning partial results", {
          page: responseBody.page,
          itemsCollected: executions.length,
        });
        return executions;
      }
      throw new Error("Missing or invalid page in PocketBase response");
    }

    if (resPage !== page) {
      throw new Error(`PocketBase returned page ${resPage} but we requested ${page}`);
    }

    if (!Array.isArray(responseBody.items)) {
      throw new Error(`PocketBase response for page ${page} did not contain an items array`);
    }

    const items = responseBody.items as IDataObject[];
    const records = items.map((item) => ({ json: item }));
    executions.push(...(await downloadRecordFiles.call(this, records)));

    hasMore = allIsActive && items.length >= readPerPage(responseBody);
    page++;
  }

  return executions;
}

interface FileTokenEntry {
  authToken: string;
  token: string;
  expiresAtMs: number;
}

const fileTokens = new Map<string, FileTokenEntry>();
const pendingFileTokens = new Map<string, Promise<string>>();
const fileFieldsCache = new Map<string, { executionId: string; fileFields: Promise<string[]> }>();

export function _resetFileCachesForTesting(): void {
  fileTokens.clear();
  pendingFileTokens.clear();
  fileFieldsCache.clear();
}

async function requestFileToken(
  this: IExecuteSingleFunctions,
  url: string,
  authToken: string,
): Promise<string> {
  const { token } = (await this.helpers.httpRequest({
    method: "POST",
    url: `${url}/api/files/token`,
    headers: { Authorization: authToken },
  })) as { token: string };
  fileTokens.set(url, { authToken, token, expiresAtMs: parseJwtExpiry(token) });
  return token;
}

async function fetchFileToken(
  this: IExecuteSingleFunctions,
  url: string,
  authToken: string,
): Promise<string> {
  const cached = fileTokens.get(url);
  if (cached?.authToken === authToken && Date.now() < cached.expiresAtMs - 60_000) {
    return cached.token;
  }
  let pending = pendingFileTokens.get(authToken);
  if (!pending) {
    pending = requestFileToken
      .call(this, url, authToken)
      .finally(() => pendingFileTokens.delete(authToken));
    pendingFileTokens.set(authToken, pending);
  }
  return pending;
}

function fetchFileFields(
  this: IExecuteSingleFunctions,
  url: string,
  authToken: string,
  collection: string,
): Promise<string[]> {
  const key = `${url}::${collection}`;
  const executionId = this.getExecutionId();
  const cached = fileFieldsCache.get(key);
  if (cached?.executionId === executionId) {
    return cached.fileFields;
  }
  const fileFields = this.helpers
    .httpRequest({
      method: "GET",
      url: `${url}/api/collections/${collection}`,
      headers: { Authorization: authToken },
    })
    .then(({ fields }: { fields: { name: string; type: string }[] }) =>
      fields.filter(({ type }) => type === "file").map(({ name }) => name),
    );
  fileFieldsCache.set(key, { executionId, fileFields });
  fileFields.catch(() => {
    if (fileFieldsCache.get(key)?.fileFields === fileFields) {
      fileFieldsCache.delete(key);
    }
  });
  return fileFields;
}

export async function downloadRecordFiles(
  this: IExecuteSingleFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
  if (!this.getNodeParameter("parameters.downloadFiles", false) || items.length === 0) {
    return items;
  }

  const credentials = await this.getCredentials("pocketbaseHttpApi");
  const url = (credentials.url as string).replace(/\/$/, "");
  const collection = this.getNodeParameter("resource") as string;
  const authToken = await fetchPocketbaseToken(
    (opts) => this.helpers.httpRequest(opts),
    url,
    credentials.username as string,
    credentials.password as string,
  );
  const fileFields = await fetchFileFields.call(this, url, authToken, collection);

  const downloadFile = async (recordId: string, fileName: string) => {
    const token = await fetchFileToken.call(this, url, authToken);
    const response = (await this.helpers.httpRequest({
      method: "GET",
      url: `${url}/api/files/${collection}/${recordId}/${encodeURIComponent(fileName)}`,
      qs: { token },
      encoding: "stream",
      returnFullResponse: true,
    })) as IN8nHttpFullResponse;
    return await this.helpers.prepareBinaryData(
      response.body as Readable,
      fileName,
      response.headers["content-type"] as string,
    );
  };

  return await Promise.all(
    items.map(async ({ json }) => {
      const files = fileFields
        .filter((field) => Object.prototype.hasOwnProperty.call(json, field) && json[field])
        .flatMap((field) =>
          Array.isArray(json[field])
            ? (json[field] as string[]).map((fileName, index) => [`${field}_${index}`, fileName])
            : [[field, json[field] as string]],
        );
      if (files.length > 0 && !json.id) {
        throw new NodeOperationError(this.getNode(), 'Add "id" to Field Names to download files');
      }
      const keys = files.map(([key]) => key);
      const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
      if (duplicate) {
        throw new NodeOperationError(
          this.getNode(),
          `Two file fields would both be saved as binary field "${duplicate}"`,
        );
      }
      const binary = await Promise.all(
        files.map(async ([key, fileName]) => [
          key,
          await downloadFile(json.id as string, fileName),
        ]),
      );
      return {
        json,
        binary: Object.fromEntries(binary),
        pairedItem: { item: this.getItemIndex() },
      };
    }),
  );
}

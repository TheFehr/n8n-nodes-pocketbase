import {
  DeclarativeRestApiSettings,
  IDataObject,
  IExecutePaginationFunctions,
  IExecuteSingleFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
} from "n8n-workflow";
import { prepareRequestBody } from "./RequestBodyFunctions";

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

export async function pagination(
  this: IExecutePaginationFunctions,
  requestOptions: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
  const allIsActive = this.getNodeParameter("parameters.allElements", false) as boolean;
  let executions: INodeExecutionData[] = [];
  let page: number = this.getNodeParameter("parameters.page", 1) as number;
  let totalPages: number = allIsActive ? Infinity : page;

  requestOptions.options ??= {};
  requestOptions.options.qs ??= {};

  const returnFullResponse = !!requestOptions.options.returnFullResponse;
  const maxPages = 1000;

  do {
    if (page > maxPages) {
      throw new Error(`Pagination exceeded maximum of ${maxPages} pages`);
    }
    requestOptions.options.qs.page = page;
    const responseData = await this.makeRoutingRequest(requestOptions);
    if (!responseData || responseData.length === 0) {
      // Empty response from the routing request itself (e.g. timeout or empty array)
      return executions;
    }
    const json = responseData?.[0]?.json;
    const responseBody = (
      returnFullResponse ? (json?.body as IDataObject) : json
    ) as IDataObject;

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

    if (allIsActive) {
      const resTotalPages = Number(responseBody.totalPages);
      if (!Number.isFinite(resTotalPages)) {
        throw new Error("Missing or invalid totalPages in PocketBase response");
      }
      totalPages = resTotalPages;
      this.logger.debug(`Fetching page ${page} of ${totalPages}`);
    }

    const items = Array.isArray(responseBody.items) ? (responseBody.items as IDataObject[]) : [];
    executions.push(...items.map((item) => ({ json: item })));

    if (items.length === 0) {
      break;
    }

    page++;
  } while (page <= totalPages);

  return executions;
}

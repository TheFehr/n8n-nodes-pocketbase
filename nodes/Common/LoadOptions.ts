import { NodeApiError } from "n8n-workflow";
import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  JsonObject,
} from "n8n-workflow";
import { fetchPocketbaseToken } from "./GenericFunctions";

export interface PocketBaseField {
  autogeneratePattern?: string;
  hidden: boolean;
  id: string;
  max?: number | string;
  min?: number | string;
  name: string;
  pattern?: string;
  presentable: boolean;
  primaryKey?: boolean;
  required?: boolean;
  system: boolean;
  type: string;
  maxSelect?: number;
  values?: string[];
  onCreate?: boolean;
  onUpdate?: boolean;
  cascadeDelete?: boolean;
  collectionId?: string;
  minSelect?: number;
}

async function loadPocketBaseFields(
  this: ILoadOptionsFunctions,
  collectionName: string | null = null,
): Promise<PocketBaseField[]> {
  const credentials = await this.getCredentials("pocketbaseHttpApi");
  const normalizedUrl = (credentials.url as string).replace(/\/$/, "");
  const resource = collectionName
    ? collectionName
    : (this.getNodeParameter("resource") as unknown as string);
  const token = await fetchPocketbaseToken(
    (opts) => this.helpers.httpRequest(opts),
    normalizedUrl,
    credentials.username as string,
    credentials.password as string,
  );
  // eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth -- httpRequestWithAuthentication relies on the credential's `authenticate` property, which this project deliberately removed (see commit 8003c58): n8n doesn't reliably invoke it during scheduled executions, causing 403s once the stored JWT expired. fetchPocketbaseToken replaces it with a reliable, cache-aware token fetch.
  const { fields } = (await this.helpers.httpRequest({
    url: `${normalizedUrl}/api/collections/${resource}`,
    method: "GET",
    headers: { Authorization: token },
  })) as { fields: PocketBaseField[] };

  return fields;
}

/**
 * Helper to generate a descriptive label from a record's data.
 */
function getRecordLabel(id: string, data: IDataObject): string {
  if (data.name !== null && data.name !== undefined && data.name !== "") {
    return String(data.name);
  }

  // Extract a descriptive label from available columns
  const shortColumns = Object.entries(data)
    .filter(([key, value]) => {
      if (key === "name" || key === "id") return false;
      const serialized = JSON.stringify(value) ?? "";
      // Rule: Accept serialized lengths > 2 and <= 30
      return serialized.length <= 30 && serialized.length > 2;
    })
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

  const fallback = shortColumns.join(", ").substring(0, 100);
  return fallback || id || "";
}

export const LoadOptions = {
  async getCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const credentials = await this.getCredentials("pocketbaseHttpApi");
    const normalizedUrl = (credentials.url as string).replace(/\/$/, "");
    const token = await fetchPocketbaseToken(
      (opts) => this.helpers.httpRequest(opts),
      normalizedUrl,
      credentials.username as string,
      credentials.password as string,
    );

    const items: { name: string }[] = [];
    let page: number = 1;
    let totalPages: number = 0;

    do {
      // eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth -- see comment in loadPocketBaseFields above
      const { items: pageItems, totalPages: pageTotalPages } = (await this.helpers.httpRequest({
        url: `${normalizedUrl}/api/collections`,
        method: "GET",
        qs: { page },
        headers: { Authorization: token },
      })) as { items: { name: string }[]; totalPages: number };

      items.push(...pageItems);
      totalPages = pageTotalPages;
      page++;
    } while (page <= totalPages);

    return items.map(({ name }) => ({ name, value: name })) as INodePropertyOptions[];
  },
  async getFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const returnData: INodePropertyOptions[] = [];
    const fields = await loadPocketBaseFields.call(this);

    fields?.forEach(({ name, type }) => {
      if (type === "relation") {
        returnData.push({
          name,
          value: name,
        });
        returnData.push({
          name: `All fields from relation '${name}'`,
          value: `expand.${name}.*`,
        });

        return;
      }

      returnData.push({
        name,
        value: name,
      });
    });

    return returnData;
  },
  async getRelations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const returnData: INodePropertyOptions[] = [];
    const fields = await loadPocketBaseFields.call(this);

    fields?.forEach(({ name, type }) => {
      if (type !== "relation") {
        return;
      }
      returnData.push({
        name,
        value: name,
      });
    });

    return returnData;
  },
  async getRows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const returnData: INodePropertyOptions[] = [];
    const credentials = await this.getCredentials("pocketbaseHttpApi");
    const normalizedUrl = (credentials.url as string).replace(/\/$/, "");
    const resource = this.getNodeParameter("resource") as unknown as string;
    const token = await fetchPocketbaseToken(
      (opts) => this.helpers.httpRequest(opts),
      normalizedUrl,
      credentials.username as string,
      credentials.password as string,
    );

    const listRecords = async (qs: IDataObject): Promise<IDataObject[]> => {
      const { items } = (await this.helpers.httpRequest({
        url: `${normalizedUrl}/api/collections/${resource}/records`,
        method: "GET",
        qs,
        headers: { Authorization: token },
      })) as { items: IDataObject[] };
      return items;
    };

    let items: IDataObject[];
    try {
      items = await listRecords({ sort: "-@rowid", perPage: 250, skipTotal: true });
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status !== 400) {
        throw new NodeApiError(this.getNode(), error as JsonObject);
      }
      items = await listRecords({ perPage: 250, skipTotal: true });
    }

    if (items.length === 0) {
      return [
        {
          name: 'No Records Found',
          value: "",
        },
      ];
    }

    items.forEach((item) => {
      const id = item.id as string;
      returnData.push({
        name: getRecordLabel(id, item),
        value: id,
      });
    });

    return returnData;
  },
};

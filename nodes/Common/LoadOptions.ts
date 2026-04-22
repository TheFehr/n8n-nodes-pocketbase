import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodePropertyOptions,
} from "n8n-workflow";

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
  const { url } = await this.getCredentials("pocketbaseHttpApi");
  const normalizedUrl = (url as string).replace(/\/$/, "");
  const resource = collectionName
    ? collectionName
    : (this.getNodeParameter("resource") as unknown as string);
  const { fields } = await this.helpers.httpRequestWithAuthentication.call(
    this,
    "pocketbaseHttpApi",
    {
      url: `${normalizedUrl}/api/collections/${resource}`,
      method: "GET",
    },
  );

  return fields as PocketBaseField[];
}

/**
 * Helper to generate a descriptive label from a record's data.
 */
function getRecordLabel(id: string, data: IDataObject): string {
  const name = data.name as string | undefined;
  if (name) return name;

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
  return fallback || id;
}

export const LoadOptions = {
  async getCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const { url } = await this.getCredentials("pocketbaseHttpApi");
    const normalizedUrl = (url as string).replace(/\/$/, "");

    const items: { name: string }[] = [];
    let page: number = 1;
    let totalPages: number = 0;

    do {
      const { items: pageItems, totalPages: pageTotalPages } =
        await this.helpers.httpRequestWithAuthentication.call(this, "pocketbaseHttpApi", {
          url: `${normalizedUrl}/api/collections`,
          method: "GET",
          qs: { page },
        });

      items.push(...pageItems);
      if (page === 1) {
        totalPages = pageTotalPages;
      }
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
    const { url } = await this.getCredentials("pocketbaseHttpApi");
    const normalizedUrl = (url as string).replace(/\/$/, "");
    const resource = this.getNodeParameter("resource") as unknown as string;

    const items: IDataObject[] = [];
    let page: number = 1;
    let totalPages: number = 1;
    const maxPages = 5; // Load up to 5 pages for the dropdown

    do {
      const { items: pageItems, totalPages: pageTotalPages } =
        await this.helpers.httpRequestWithAuthentication.call(this, "pocketbaseHttpApi", {
          url: `${normalizedUrl}/api/collections/${resource}/records`,
          method: "GET",
          qs: { sort: "-created", page, perPage: 50 },
        });

      items.push(...(pageItems as IDataObject[]));
      totalPages = pageTotalPages;
      page++;
    } while (page <= totalPages && page <= maxPages);

    if (items.length === 0) {
      return [
        {
          name: "No records found",
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

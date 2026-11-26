import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NodeHelpers,
  NodeOperationError,
  type DeclarativeRestApiSettings,
  type IExecutePaginationFunctions,
  type IExecuteSingleFunctions,
  type IHttpRequestOptions,
  type INode,
  type INodeProperties,
  type INodePropertyOptions,
} from "n8n-workflow";
import { PocketbaseAdmin } from "../nodes/PocketbaseAdmin/PocketbaseAdmin.node";
import {
  authenticatePreSend,
  collectionCreatePreSendAction,
  collectionUpdatePreSendAction,
  pagination,
} from "../nodes/Common/GenericFunctions";

const { description } = new PocketbaseAdmin();
const property = (name: string) => description.properties.find((p) => p.name === name)!;
const operations = property("operation").options as INodePropertyOptions[];
const operation = (value: string) => operations.find((o) => o.value === value)!;

function visible(parameters: Record<string, string>): string[] {
  const values = { resource: "collection", ...parameters };
  const node: INode = {
    id: "test",
    name: "Pocketbase Admin",
    type: "pocketbaseAdmin",
    typeVersion: 1,
    position: [0, 0],
    parameters: values,
  };
  return description.properties
    .filter((p) => NodeHelpers.displayParameter(values, p, node, description, values))
    .map((p) => p.name);
}

describe("PocketbaseAdmin description", () => {
  const always = ["resource", "operation"];

  it.each([
    ["search", ["parameters"]],
    ["view", ["collectionName"]],
    ["delete", ["collectionName"]],
    ["truncate", ["collectionName"]],
    ["update", ["collectionName", "definition"]],
    ["create", ["name", "collectionType", "definition"]],
  ])("shows only the parameters %s needs", (value, expected) => {
    expect(visible({ operation: value, collectionType: "base" })).toEqual([...always, ...expected]);
  });

  it.each(["base", "auth"])("hides View Query when creating a %s collection", (collectionType) => {
    expect(visible({ operation: "create", collectionType })).not.toContain("viewQuery");
  });

  it("shows View Query when creating a view collection", () => {
    expect(visible({ operation: "create", collectionType: "view" })).toContain("viewQuery");
  });

  it("requires the inputs that name or define what is changed", () => {
    for (const name of ["collectionName", "name", "viewQuery"]) {
      expect(property(name).required, name).toBe(true);
    }
  });

  it("never preselects a collection and lists collections by default", () => {
    expect(property("collectionName").default).toBe("");
    expect(property("operation").default).toBe("search");
  });

  const oneCollection = '=/api/collections/{{encodeURIComponent($parameter["collectionName"])}}';

  it.each([
    ["create", "POST", "/api/collections"],
    ["search", "GET", "/api/collections"],
    ["view", "GET", oneCollection],
    ["update", "PATCH", oneCollection],
    ["delete", "DELETE", oneCollection],
    ["truncate", "DELETE", `${oneCollection}/truncate`],
  ])("routes %s to %s %s", (value, method, url) => {
    expect(operation(value).routing!.request).toEqual({ method, url });
  });

  it.each(operations.map((o) => o.value))("authenticates %s before anything else", (value) => {
    expect(operation(value as string).routing!.send!.preSend![0]).toBe(authenticatePreSend);
  });

  it.each([
    ["create", collectionCreatePreSendAction],
    ["update", collectionUpdatePreSendAction],
  ])("builds the body of %s", (value, action) => {
    expect(operation(value).routing!.send!.preSend).toEqual([authenticatePreSend, action]);
  });

  it.each(["delete", "truncate"])("reports success for the empty response of %s", (value) => {
    expect(operation(value).routing!.output!.postReceive).toEqual([
      { type: "set", properties: { value: '={{ { "success": true } }}' } },
    ]);
  });

  it("sends each list parameter as the matching query parameter", () => {
    const sent = (property("parameters").options as INodeProperties[])
      .filter((option) => option.routing)
      .map((option) => [option.name, option.routing!.send]);

    expect(Object.fromEntries(sent)).toEqual({
      elementsPerPage: { type: "query", property: "perPage" },
      filter: { type: "query", property: "filter" },
      page: { type: "query", property: "page" },
      sort: { type: "query", property: "sort" },
    });
  });
});

describe("PocketbaseAdmin request bodies", () => {
  const options = (): IHttpRequestOptions => ({ url: "/api/collections", method: "POST" });
  const context = (parameters: Record<string, unknown>) =>
    ({
      getNodeParameter: vi.fn((name: string, fallback?: unknown) => parameters[name] ?? fallback),
      getNode: vi.fn(() => ({ name: "Pocketbase Admin" })),
    }) as unknown as IExecuteSingleFunctions;
  const create = async (parameters: Record<string, unknown>) =>
    (await collectionCreatePreSendAction.call(context(parameters), options())).body;
  const update = async (definition: unknown) =>
    (await collectionUpdatePreSendAction.call(context({ definition }), options())).body;

  it.each(["base", "auth"])("creates a %s collection without a view query", async (type) => {
    expect(await create({ name: "posts", collectionType: type, viewQuery: "SELECT 1" })).toEqual({
      name: "posts",
      type,
    });
  });

  it("creates a view collection with its query", async () => {
    expect(
      await create({ name: "v", collectionType: "view", viewQuery: "SELECT id FROM posts" }),
    ).toEqual({ name: "v", type: "view", viewQuery: "SELECT id FROM posts" });
  });

  const definition = {
    fields: [{ name: "title", type: "text", required: true }],
    indexes: ["CREATE INDEX idx ON posts (title)"],
    listRule: null,
    viewRule: "",
  };

  it.each([
    ["a string", JSON.stringify(definition)],
    ["an object from an expression", definition],
  ])("keeps every property of a definition given as %s", async (_, value) => {
    expect(await create({ name: "posts", collectionType: "base", definition: value })).toEqual({
      ...definition,
      name: "posts",
      type: "base",
    });
    expect(await update(value)).toEqual(definition);
  });

  it("lets Name, Type and View Query win over the definition", async () => {
    expect(
      await create({
        name: "chosen",
        collectionType: "view",
        viewQuery: "SELECT id FROM a",
        definition: { name: "other", type: "auth", viewQuery: "SELECT id FROM b" },
      }),
    ).toEqual({ name: "chosen", type: "view", viewQuery: "SELECT id FROM a" });
  });

  it("sends only what the definition holds on update", async () => {
    expect(await update('{"name": "renamed"}')).toEqual({ name: "renamed" });
    expect(await update("{}")).toEqual({});
    expect(await update(undefined)).toEqual({});
  });

  it.each([
    ["malformed JSON", "{oops", "Invalid JSON"],
    ["an empty string", "", "Invalid JSON"],
    ["a JSON array", "[]", "must be a JSON object"],
    ["a JSON null", "null", "must be a JSON object"],
    ["a JSON number", "5", "must be a JSON object"],
    ["an array value", [], "must be a JSON object or string"],
    ["a number value", 5, "must be a JSON object or string"],
  ])("rejects %s as definition", async (_, value, message) => {
    for (const attempt of [
      update(value),
      create({ name: "posts", collectionType: "base", definition: value }),
    ]) {
      await expect(attempt).rejects.toThrow(NodeOperationError);
      await expect(attempt).rejects.toThrow(message);
    }
  });
});

describe("PocketbaseAdmin list pagination", () => {
  let parameters: Record<string, unknown>;
  let pages: string[][];
  let requested: Record<string, unknown>[];

  beforeEach(() => {
    parameters = {};
    pages = [["a", "b"], ["c"]];
    requested = [];
  });

  const list = async () => {
    const context = {
      getNodeParameter: vi.fn((name: string, fallback?: unknown) => parameters[name] ?? fallback),
      makeRoutingRequest: vi.fn(async (request: DeclarativeRestApiSettings.ResultOptions) => {
        const qs = { ...request.options.qs! };
        requested.push(qs);
        const page = qs.page as number;
        const items = (pages[page - 1] ?? []).map((name) => ({ name }));
        return [{ json: { page, perPage: 2, items } }];
      }),
    } as unknown as IExecutePaginationFunctions;
    const result = await pagination.call(context, {
      options: { qs: {} },
    } as unknown as DeclarativeRestApiSettings.ResultOptions);
    return result.map((item) => item.json.name);
  };

  it("returns one page by default", async () => {
    expect(await list()).toEqual(["a", "b"]);
    expect(requested).toEqual([{ page: 1, skipTotal: true }]);
  });

  it("returns the requested page", async () => {
    parameters["parameters.page"] = 2;

    expect(await list()).toEqual(["c"]);
  });

  it("walks every page with All Elements", async () => {
    parameters["parameters.allElements"] = true;

    expect(await list()).toEqual(["a", "b", "c"]);
    expect(requested.map((qs) => qs.page)).toEqual([1, 2]);
  });

  it("returns nothing when there are no collections", async () => {
    pages = [];

    expect(await list()).toEqual([]);
  });
});

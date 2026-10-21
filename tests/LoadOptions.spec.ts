import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodeApiError, type IHttpRequestOptions, type ILoadOptionsFunctions } from "n8n-workflow";
import { LoadOptions, _resetCollectionTypeCacheForTesting } from "../nodes/Common/LoadOptions";
import { _resetTokenCacheForTesting } from "../nodes/Common/GenericFunctions";

describe("LoadOptions.getRows", () => {
  let httpRequest: ReturnType<typeof vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>>;
  let context: ILoadOptionsFunctions;
  let collectionTypes: Record<string, string>;

  beforeEach(() => {
    _resetTokenCacheForTesting();
    _resetCollectionTypeCacheForTesting();
    collectionTypes = { posts: "base", posts_view: "view" };
    httpRequest = vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>();
    httpRequest.mockImplementation(async (options) => {
      if (options.method === "POST") return { token: "token" };
      if (options.url.endsWith("/api/collections")) {
        return {
          totalPages: 1,
          items: Object.entries(collectionTypes).map(([name, type]) => ({ name, type })),
        };
      }
      const collection = options.url.match(/\/api\/collections\/([^/]+)/)![1];
      if (options.url.endsWith("/records")) {
        return { items: [{ id: "abc", name: `Latest in ${collection}` }] };
      }
      return { name: collection, type: collectionTypes[collection], fields: [] };
    });
    context = {
      getCredentials: vi.fn().mockResolvedValue({
        url: "http://localhost:8090/",
        username: "admin@example.com",
        password: "password123",
      }),
      getNodeParameter: vi.fn().mockReturnValue("posts"),
      getNode: vi.fn().mockReturnValue({ name: "Pocketbase HTTP", type: "pocketbaseHttp" }),
      helpers: { httpRequest },
    } as unknown as ILoadOptionsFunctions;
  });

  const requestsTo = (pattern: RegExp) =>
    httpRequest.mock.calls
      .map(([options]) => options)
      .filter((options) => pattern.test(options.url));

  it("loads the 250 most recent records in a single request without counting", async () => {
    const options = await LoadOptions.getRows.call(context);

    expect(options).toEqual([{ name: "Latest in posts", value: "abc" }]);
    expect(requestsTo(/\/records$/)).toHaveLength(1);
    expect(requestsTo(/\/records$/)[0].qs).toEqual({
      sort: "-@rowid",
      perPage: 250,
      skipTotal: true,
    });
  });

  it("doesn't sort view collections, which can't be sorted by rowid", async () => {
    vi.mocked(context.getNodeParameter).mockReturnValue("posts_view");

    await LoadOptions.getRows.call(context);

    expect(requestsTo(/\/records$/)[0].qs).toEqual({ perPage: 250, skipTotal: true });
  });

  it("looks up a collection's type only once", async () => {
    await LoadOptions.getRows.call(context);
    await LoadOptions.getRows.call(context);

    expect(requestsTo(/\/api\/collections\/posts$/)).toHaveLength(1);
  });

  it("reuses collection types already loaded for the collection dropdown", async () => {
    await LoadOptions.getCollections.call(context);
    vi.mocked(context.getNodeParameter).mockReturnValue("posts_view");
    await LoadOptions.getRows.call(context);

    expect(requestsTo(/\/api\/collections\/[^/]+$/)).toHaveLength(0);
    expect(requestsTo(/\/records$/)[0].qs).toEqual({ perPage: 250, skipTotal: true });
  });

  it("reuses collection types loaded for the field dropdowns", async () => {
    vi.mocked(context.getNodeParameter).mockReturnValue("posts_view");
    await LoadOptions.getFields.call(context);
    await LoadOptions.getRows.call(context);

    expect(requestsTo(/\/api\/collections\/posts_view$/)).toHaveLength(1);
    expect(requestsTo(/\/records$/)[0].qs).toEqual({ perPage: 250, skipTotal: true });
  });

  it("re-checks a cached type when loading fails and retries if the type changed", async () => {
    await LoadOptions.getCollections.call(context);
    collectionTypes.posts = "view";
    const recordsHandler = httpRequest.getMockImplementation()!;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/records") && options.qs?.sort) {
        throw Object.assign(new Error("Bad Request"), { response: { status: 400 } });
      }
      return await recordsHandler(options);
    });

    const options = await LoadOptions.getRows.call(context);

    expect(options).toEqual([{ name: "Latest in posts", value: "abc" }]);
    expect(requestsTo(/\/records$/).map((request) => request.qs)).toEqual([
      { sort: "-@rowid", perPage: 250, skipTotal: true },
      { perPage: 250, skipTotal: true },
    ]);
  });

  it("doesn't retry when the type is unchanged", async () => {
    const recordsHandler = httpRequest.getMockImplementation()!;
    httpRequest.mockImplementation(async (options) => {
      if (options.url.endsWith("/records")) {
        throw Object.assign(new Error("Forbidden"), { response: { status: 403 } });
      }
      return await recordsHandler(options);
    });

    await expect(LoadOptions.getRows.call(context)).rejects.toBeInstanceOf(NodeApiError);
    expect(requestsTo(/\/records$/)).toHaveLength(1);
  });
});

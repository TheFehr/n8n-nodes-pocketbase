import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IHttpRequestOptions, ILoadOptionsFunctions } from "n8n-workflow";
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
      return { type: collectionTypes[collection] };
    });
    context = {
      getCredentials: vi.fn().mockResolvedValue({
        url: "http://localhost:8090/",
        username: "admin@example.com",
        password: "password123",
      }),
      getNodeParameter: vi.fn().mockReturnValue("posts"),
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
});

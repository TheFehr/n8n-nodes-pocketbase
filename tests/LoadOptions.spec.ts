import { describe, it, expect, vi, beforeEach } from "vitest";
import { NodeApiError, type IHttpRequestOptions, type ILoadOptionsFunctions } from "n8n-workflow";
import { LoadOptions } from "../nodes/Common/LoadOptions";
import { _resetTokenCacheForTesting } from "../nodes/Common/GenericFunctions";

describe("LoadOptions.getRows", () => {
  let httpRequest: ReturnType<typeof vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>>;
  let context: ILoadOptionsFunctions;

  beforeEach(() => {
    _resetTokenCacheForTesting();
    httpRequest = vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>();
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

  const recordRequests = () =>
    httpRequest.mock.calls
      .map(([options]) => options)
      .filter((options) => options.url.endsWith("/api/collections/posts/records"));

  it("loads the 250 most recent records in a single request without counting", async () => {
    httpRequest.mockImplementation(async (options) =>
      options.method === "POST" ? { token: "token" } : { items: [{ id: "abc", name: "Latest" }] },
    );

    const options = await LoadOptions.getRows.call(context);

    expect(options).toEqual([{ name: "Latest", value: "abc" }]);
    expect(recordRequests()).toHaveLength(1);
    expect(recordRequests()[0].qs).toEqual({ sort: "-@rowid", perPage: 250, skipTotal: true });
  });

  it("retries without sorting when the collection can't be sorted by rowid", async () => {
    httpRequest.mockImplementation(async (options) => {
      if (options.method === "POST") return { token: "token" };
      if (options.qs?.sort)
        throw Object.assign(new Error("Bad Request"), { response: { status: 400 } });
      return { items: [{ id: "abc", name: "From view" }] };
    });

    const options = await LoadOptions.getRows.call(context);

    expect(options).toEqual([{ name: "From view", value: "abc" }]);
    expect(recordRequests().map((request) => request.qs)).toEqual([
      { sort: "-@rowid", perPage: 250, skipTotal: true },
      { perPage: 250, skipTotal: true },
    ]);
  });

  it("does not retry when the request fails for another reason", async () => {
    const forbidden = Object.assign(new Error("Forbidden"), { response: { status: 403 } });
    httpRequest.mockImplementation(async (options) => {
      if (options.method === "POST") return { token: "token" };
      throw forbidden;
    });

    await expect(LoadOptions.getRows.call(context)).rejects.toBeInstanceOf(NodeApiError);
    expect(recordRequests()).toHaveLength(1);
  });
});

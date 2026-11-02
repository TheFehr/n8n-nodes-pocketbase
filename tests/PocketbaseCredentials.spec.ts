import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IHttpRequestOptions } from "n8n-workflow";
import { fetchPocketbaseToken, _resetTokenCacheForTesting } from "../nodes/Common/GenericFunctions";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${header}.${body}.fakesig`;
}

describe("fetchPocketbaseToken", () => {
  let mockHttpRequest: ReturnType<typeof vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>>;

  beforeEach(() => {
    _resetTokenCacheForTesting();
    mockHttpRequest = vi.fn<(options: IHttpRequestOptions) => Promise<unknown>>().mockResolvedValue({
      token: "mock-jwt-token",
    });
  });

  it("fetches a token and calls the auth endpoint", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const expectedToken = buildJwt({ exp: futureExp });
    mockHttpRequest.mockResolvedValue({ token: expectedToken });

    const token = await fetchPocketbaseToken(
      mockHttpRequest,
      "http://localhost:8090",
      "admin@example.com",
      "password123",
    );

    expect(token).toBe(expectedToken);
    expect(mockHttpRequest).toHaveBeenCalledOnce();
    expect(mockHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
      body: { identity: "admin@example.com", password: "password123" },
    });
  });

  it("reuses cached token when it is not expired", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const freshToken = buildJwt({ exp: futureExp });
    mockHttpRequest.mockResolvedValue({ token: freshToken });

    await fetchPocketbaseToken(mockHttpRequest, "http://cache-hit.local", "admin", "pass");
    const second = await fetchPocketbaseToken(mockHttpRequest, "http://cache-hit.local", "admin", "pass");

    expect(second).toBe(freshToken);
    expect(mockHttpRequest).toHaveBeenCalledOnce();
  });

  it("re-fetches when cached token is within 60 s of expiry", async () => {
    const nearExp = Math.floor(Date.now() / 1000) + 30;
    const soonToken = buildJwt({ exp: nearExp });
    mockHttpRequest.mockResolvedValueOnce({ token: soonToken });
    mockHttpRequest.mockResolvedValueOnce({ token: "refreshed-token" });

    await fetchPocketbaseToken(mockHttpRequest, "http://near-expiry.local", "admin", "pass");
    const second = await fetchPocketbaseToken(mockHttpRequest, "http://near-expiry.local", "admin", "pass");

    expect(second).toBe("refreshed-token");
    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when cached token is already expired", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const staleToken = buildJwt({ exp: pastExp });
    mockHttpRequest.mockResolvedValueOnce({ token: staleToken });
    mockHttpRequest.mockResolvedValueOnce({ token: "fresh-token" });

    await fetchPocketbaseToken(mockHttpRequest, "http://expired.local", "admin", "pass");
    const second = await fetchPocketbaseToken(mockHttpRequest, "http://expired.local", "admin", "pass");

    expect(second).toBe("fresh-token");
    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
  });

  it("propagates HTTP errors from the auth endpoint", async () => {
    const networkError = new Error("connect ECONNREFUSED");
    mockHttpRequest.mockRejectedValue(networkError);

    await expect(
      fetchPocketbaseToken(mockHttpRequest, "http://unreachable.local", "admin", "pass"),
    ).rejects.toThrow("connect ECONNREFUSED");
  });

  it("fetches a new token when the password changes", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const url = "http://rotate.local";
    mockHttpRequest.mockResolvedValueOnce({ token: buildJwt({ exp: futureExp, n: 1 }) });
    mockHttpRequest.mockResolvedValueOnce({ token: buildJwt({ exp: futureExp, n: 2 }) });

    const first = await fetchPocketbaseToken(mockHttpRequest, url, "admin", "old");
    const second = await fetchPocketbaseToken(mockHttpRequest, url, "admin", "new");

    expect(second).not.toBe(first);
    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
    expect(mockHttpRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: { identity: "admin", password: "new" } }),
    );
  });

  it("does not share tokens between credentials with different passwords", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const url = "http://shared.local";
    const tokenA = buildJwt({ exp: futureExp, n: 1 });
    const tokenB = buildJwt({ exp: futureExp, n: 2 });
    mockHttpRequest.mockResolvedValueOnce({ token: tokenA });
    mockHttpRequest.mockResolvedValueOnce({ token: tokenB });

    await fetchPocketbaseToken(mockHttpRequest, url, "admin", "a");
    await fetchPocketbaseToken(mockHttpRequest, url, "admin", "b");
    const cachedA = await fetchPocketbaseToken(mockHttpRequest, url, "admin", "a");
    const cachedB = await fetchPocketbaseToken(mockHttpRequest, url, "admin", "b");

    expect(cachedA).toBe(tokenA);
    expect(cachedB).toBe(tokenB);
    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
  });

  it("logs in once for concurrent calls", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const freshToken = buildJwt({ exp: futureExp });
    mockHttpRequest.mockResolvedValue({ token: freshToken });

    const tokens = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetchPocketbaseToken(mockHttpRequest, "http://concurrent.local", "admin", "pass"),
      ),
    );

    expect(tokens).toEqual(Array(20).fill(freshToken));
    expect(mockHttpRequest).toHaveBeenCalledOnce();
  });

  it("does not cache a failed login", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const url = "http://retry.local";
    const freshToken = buildJwt({ exp: futureExp });
    mockHttpRequest.mockRejectedValueOnce(new Error("Failed to authenticate"));
    mockHttpRequest.mockResolvedValueOnce({ token: freshToken });

    const failed = await Promise.allSettled([
      fetchPocketbaseToken(mockHttpRequest, url, "admin", "pass"),
      fetchPocketbaseToken(mockHttpRequest, url, "admin", "pass"),
    ]);
    const retried = await fetchPocketbaseToken(mockHttpRequest, url, "admin", "pass");

    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(retried).toBe(freshToken);
    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
  });

  it("re-fetches every call when the token has no exp claim", async () => {
    const noExpToken = buildJwt({});
    mockHttpRequest.mockResolvedValue({ token: noExpToken });

    await fetchPocketbaseToken(mockHttpRequest, "http://no-exp.local", "admin", "pass");
    await fetchPocketbaseToken(mockHttpRequest, "http://no-exp.local", "admin", "pass");

    expect(mockHttpRequest).toHaveBeenCalledTimes(2);
  });
});

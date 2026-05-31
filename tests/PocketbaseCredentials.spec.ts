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
    const token = await fetchPocketbaseToken(
      mockHttpRequest,
      "http://localhost:8090",
      "admin@example.com",
      "password123",
    );

    expect(token).toBe("mock-jwt-token");
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
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, refresh, inFlightRequests } from "../nodes/Common/PocketbaseAuth";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

describe("PocketbaseAuth", () => {
  let mockThis: any;
  const credentials = {
    url: "http://localhost:8090",
    username: "test@example.com",
    password: "password123",
  } as unknown as ICredentialDataDecryptedObject;

  beforeEach(() => {
    vi.clearAllMocks();
    inFlightRequests.clear();
    mockThis = {
      helpers: {
        httpRequest: vi.fn(),
      },
    };
  });

  it("should perform login and return token", async () => {
    mockThis.helpers.httpRequest.mockResolvedValue({ token: "mock-token" });

    const result = await login.call(mockThis as unknown as IHttpRequestHelper, credentials);

    expect(result.token).toBe("mock-token");
    expect(mockThis.helpers.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
        body: {
          identity: "test@example.com",
          password: "password123",
        },
      }),
    );
  });

  it("should deduplicate concurrent login requests", async () => {
    let resolvePromise: (value: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockThis.helpers.httpRequest.mockReturnValue(pendingPromise);

    const call1 = login.call(mockThis as unknown as IHttpRequestHelper, credentials);
    const call2 = login.call(mockThis as unknown as IHttpRequestHelper, credentials);

    expect(mockThis.helpers.httpRequest).toHaveBeenCalledTimes(1);

    resolvePromise!({ token: "deduped-token" });
    const [res1, res2] = await Promise.all([call1, call2]);

    expect(res1.token).toBe("deduped-token");
    expect(res2.token).toBe("deduped-token");
  });

  it("should refresh token if expired", async () => {
    // Mock an expired token
    const expiredTime = Math.floor(Date.now() / 1000) - 60;
    const payload = Buffer.from(JSON.stringify({ exp: expiredTime }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const expiredToken = `header.${payload}.signature`;

    const credsWithToken = {
      ...credentials,
      token: expiredToken,
    } as unknown as ICredentialDataDecryptedObject;

    mockThis.helpers.httpRequest.mockResolvedValue({ token: "new-token" });

    const result = await refresh.call(mockThis as unknown as IHttpRequestHelper, credsWithToken);

    expect(result.token).toBe("new-token");
    expect(mockThis.helpers.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-refresh",
      }),
    );
  });

  it("should return existing token if not expired", async () => {
    // Mock a valid token
    const futureTime = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp: futureTime }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const validToken = `header.${payload}.signature`;

    const credsWithToken = {
      ...credentials,
      token: validToken,
    } as unknown as ICredentialDataDecryptedObject;

    const result = await refresh.call(mockThis as unknown as IHttpRequestHelper, credsWithToken);

    expect(result.token).toBe(validToken);
    expect(mockThis.helpers.httpRequest).not.toHaveBeenCalled();
  });

  it("should fallback to login if refresh fails with 401", async () => {
    const expiredTime = Math.floor(Date.now() / 1000) - 60;
    const payload = Buffer.from(JSON.stringify({ exp: expiredTime }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const expiredToken = `header.${payload}.signature`;

    const credsWithToken = {
      ...credentials,
      token: expiredToken,
    } as unknown as ICredentialDataDecryptedObject;

    // First call (refresh) fails
    const error: any = new Error("Unauthorized");
    error.status = 401;
    mockThis.helpers.httpRequest.mockRejectedValueOnce(error);
    // Second call (login) succeeds
    mockThis.helpers.httpRequest.mockResolvedValueOnce({ token: "login-token" });

    const result = await refresh.call(mockThis as unknown as IHttpRequestHelper, credsWithToken);

    expect(result.token).toBe("login-token");
    expect(mockThis.helpers.httpRequest).toHaveBeenCalledTimes(2);
  });
});

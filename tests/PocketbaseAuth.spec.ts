import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, refresh, inFlightRequests } from "../nodes/Common/PocketbaseAuth";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

describe("PocketbaseAuth", () => {
  beforeEach(() => {
    inFlightRequests.clear();
  });

  describe("login", () => {
    it("should login and return a token", async () => {
      const mockHttpRequest = vi.fn().mockResolvedValue({ token: "mock-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      const result = await login.call(mockThis, credentials);

      expect(result).toEqual({ token: "mock-token" });
      expect(mockHttpRequest).toHaveBeenCalledWith({
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
        body: {
          identity: "test@example.com",
          password: "password123",
        },
      });
    });

    it("should handle URL with trailing slash correctly", async () => {
      const mockHttpRequest = vi.fn().mockResolvedValue({ token: "mock-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090/",
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      const result = await login.call(mockThis, credentials);

      expect(result).toEqual({ token: "mock-token" });
      expect(mockHttpRequest).toHaveBeenCalledWith({
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
        body: {
          identity: "test@example.com",
          password: "password123",
        },
      });
    });

    it("should throw error if url is missing", async () => {
      const mockThis = {} as unknown as IHttpRequestHelper;
      const credentials = {
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(login.call(mockThis, credentials)).rejects.toThrow(
        "PocketBase URL is missing or invalid in Credentials",
      );
    });

    it("should throw error if username is missing", async () => {
      const mockThis = {} as unknown as IHttpRequestHelper;
      const credentials = {
        url: "http://localhost:8090",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(login.call(mockThis, credentials)).rejects.toThrow(
        "PocketBase Admin username is missing or invalid in Credentials",
      );
    });

    it("should throw error if password is missing", async () => {
      const mockThis = {} as unknown as IHttpRequestHelper;
      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(login.call(mockThis, credentials)).rejects.toThrow(
        "PocketBase Admin password is missing or invalid in Credentials",
      );
    });

    it("should handle auth failure", async () => {
      const mockHttpRequest = vi.fn().mockRejectedValue({ status: 401, message: "Unauthorized" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "wrongpassword",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(login.call(mockThis, credentials)).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("refresh", () => {
    it("should refresh the token successfully if it is expired", async () => {
      const mockHttpRequest = vi.fn().mockResolvedValue({ token: "new-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      // Mock an expired token
      const expiredTime = Math.floor(Date.now() / 1000) - 60;
      const payload = Buffer.from(JSON.stringify({ exp: expiredTime })).toString("base64");
      const expiredToken = `header.${payload}.signature`;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
        token: expiredToken,
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: "new-token" });
      expect(mockHttpRequest).toHaveBeenCalledWith({
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-refresh",
        headers: {
          Authorization: expiredToken,
        },
      });
    });

    it("should NOT refresh the token if it is not expired", async () => {
      const mockHttpRequest = vi.fn();

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      // Mock a valid token (expiring in 1 hour)
      const validTime = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(JSON.stringify({ exp: validTime })).toString("base64");
      const validToken = `header.${payload}.signature`;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
        token: validToken,
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: validToken });
      expect(mockHttpRequest).not.toHaveBeenCalled();
    });

    it("should fall back to login if refresh fails with 401 (e.g. password changed)", async () => {
      const mockHttpRequest = vi
        .fn()
        .mockRejectedValueOnce({ status: 401, message: "Unauthorized" })
        .mockResolvedValueOnce({ token: "fresh-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "new-password123",
        token: "invalidated-token",
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: "fresh-token" });
      expect(mockHttpRequest).toHaveBeenCalledTimes(2);

      // First call: attempt refresh
      expect(mockHttpRequest).toHaveBeenNthCalledWith(1, {
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-refresh",
        headers: {
          Authorization: "invalidated-token",
        },
      });

      // Second call: fallback login
      expect(mockHttpRequest).toHaveBeenNthCalledWith(2, {
        method: "POST",
        url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
        body: {
          identity: "test@example.com",
          password: "new-password123",
        },
      });
    });

    it("should fall back to login if refresh fails with 403", async () => {
      const mockHttpRequest = vi
        .fn()
        .mockRejectedValueOnce({ status: 403, message: "Forbidden" })
        .mockResolvedValueOnce({ token: "fresh-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "new-password123",
        token: "invalidated-token",
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: "fresh-token" });
      expect(mockHttpRequest).toHaveBeenCalledTimes(2);
      expect(mockHttpRequest).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          url: "http://localhost:8090/api/collections/_superusers/auth-refresh",
        }),
      );
      expect(mockHttpRequest).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
        }),
      );
    });

    it("should fall back to login if refresh fails with 404", async () => {
      const mockHttpRequest = vi
        .fn()
        .mockRejectedValueOnce({ status: 404, message: "Not Found" })
        .mockResolvedValueOnce({ token: "fresh-token" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "new-password123",
        token: "invalidated-token",
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: "fresh-token" });
      expect(mockHttpRequest).toHaveBeenCalledTimes(2);
    });

    it("should throw error if credentials are invalid (via shared validation)", async () => {
      const mockThis = {} as unknown as IHttpRequestHelper;
      const credentials = {
        url: "http://localhost:8090",
        // missing username and password
        token: "some-token",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(refresh.call(mockThis, credentials)).rejects.toThrow(
        "PocketBase Admin username is missing or invalid in Credentials",
      );
    });

    it("should rethrow error if it is missing status", async () => {
      const mockHttpRequest = vi.fn().mockRejectedValue(new Error("Network Error"));

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
        token: "some-token",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(refresh.call(mockThis, credentials)).rejects.toThrow("Network Error");
    });

    it("should throw original error if status is not 401/403/404", async () => {
      const mockHttpRequest = vi.fn().mockRejectedValue({ status: 500, message: "Server Error" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      // Mock an expired token
      const expiredTime = Math.floor(Date.now() / 1000) - 60;
      const payload = Buffer.from(JSON.stringify({ exp: expiredTime })).toString("base64");
      const expiredToken = `header.${payload}.signature`;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
        token: expiredToken,
      } as unknown as ICredentialDataDecryptedObject;

      await expect(refresh.call(mockThis, credentials)).rejects.toMatchObject({ status: 500 });
    });
  });

  describe("Deduplication", () => {
    it("should deduplicate multiple concurrent login calls", async () => {
      let requestCount = 0;
      const mockHttpRequest = vi.fn().mockImplementation(async () => {
        requestCount++;
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { token: "deduplicated-token" };
      });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      // Start multiple logins concurrently
      const results = await Promise.all([
        login.call(mockThis, credentials),
        login.call(mockThis, credentials),
        login.call(mockThis, credentials),
      ]);

      expect(requestCount).toBe(1);
      expect(results[0]).toEqual({ token: "deduplicated-token" });
      expect(results[1]).toEqual({ token: "deduplicated-token" });
      expect(results[2]).toEqual({ token: "deduplicated-token" });
    });

    it("should deduplicate concurrent refresh and login calls", async () => {
      let requestCount = 0;
      const mockHttpRequest = vi.fn().mockImplementation(async () => {
        requestCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { token: "shared-token" };
      });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      // Mock an expired token for refresh
      const expiredTime = Math.floor(Date.now() / 1000) - 60;
      const payload = Buffer.from(JSON.stringify({ exp: expiredTime })).toString("base64");
      const expiredToken = `header.${payload}.signature`;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
        token: expiredToken,
      } as unknown as ICredentialDataDecryptedObject;

      // Mix refresh and login
      const results = await Promise.all([
        refresh.call(mockThis, credentials),
        login.call(mockThis, credentials),
      ]);

      expect(requestCount).toBe(1);
      expect(results[0]).toEqual({ token: "shared-token" });
      expect(results[1]).toEqual({ token: "shared-token" });
    });

    it("should allow new request after the previous one finished", async () => {
      let requestCount = 0;
      const mockHttpRequest = vi.fn().mockImplementation(async () => {
        requestCount++;
        return { token: `token-${requestCount}` };
      });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      // First call
      const res1 = await login.call(mockThis, credentials);
      expect(requestCount).toBe(1);
      expect(res1.token).toBe("token-1");

      // Second call (after first finished)
      const res2 = await login.call(mockThis, credentials);
      expect(requestCount).toBe(2);
      expect(res2.token).toBe("token-2");
    });

    it("should NOT deduplicate calls for different credentials", async () => {
      let requestCount = 0;
      const mockHttpRequest = vi.fn().mockImplementation(async (options) => {
        requestCount++;
        const id = options.body?.identity || options.headers?.Authorization || requestCount;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { token: `token-${id}` };
      });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const creds1 = {
        url: "http://localhost:8090",
        username: "user1@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      const creds2 = {
        url: "http://localhost:8090",
        username: "user2@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      const results = await Promise.all([login.call(mockThis, creds1), login.call(mockThis, creds2)]);

      expect(requestCount).toBe(2);
      expect(results[0].token).toBe("token-user1@example.com");
      expect(results[1].token).toBe("token-user2@example.com");
    });

    it("should propagate errors to all waiting concurrent callers", async () => {
      let requestCount = 0;
      const mockHttpRequest = vi.fn().mockImplementation(async () => {
        requestCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw { status: 401, message: "Invalid credentials" };
      });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        username: "test@example.com",
        password: "password123",
      } as unknown as ICredentialDataDecryptedObject;

      const results = await Promise.allSettled([
        login.call(mockThis, credentials),
        login.call(mockThis, credentials),
      ]);

      expect(requestCount).toBe(1);
      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("rejected");
      expect((results[0] as any).reason).toEqual({ status: 401, message: "Invalid credentials" });
      expect((results[1] as any).reason).toEqual({ status: 401, message: "Invalid credentials" });
    });
  });
});

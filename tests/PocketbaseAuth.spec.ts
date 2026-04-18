import { describe, it, expect, vi } from "vitest";
import { login, refresh } from "../nodes/Common/PocketbaseAuth";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

describe("PocketbaseAuth", () => {
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
        token: validToken,
      } as unknown as ICredentialDataDecryptedObject;

      const result = await refresh.call(mockThis, credentials);

      expect(result).toEqual({ token: validToken });
      expect(mockHttpRequest).not.toHaveBeenCalled();
    });

    it("should fall back to login if refresh fails with 401 (e.g. password changed)", async () => {
      const mockHttpRequest = vi.fn()
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

    it("should throw original error if status is not 401/403/404", async () => {
      const mockHttpRequest = vi.fn().mockRejectedValue({ status: 500, message: "Server Error" });

      const mockThis = {
        helpers: {
          httpRequest: mockHttpRequest,
        },
      } as unknown as IHttpRequestHelper;

      const credentials = {
        url: "http://localhost:8090",
        token: "old-token",
      } as unknown as ICredentialDataDecryptedObject;

      await expect(refresh.call(mockThis, credentials)).rejects.toMatchObject({ status: 500 });
    });
  });
});

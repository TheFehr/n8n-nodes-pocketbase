import { describe, it, expect, vi } from "vitest";
import { login } from "../nodes/PocketbaseHttp/PocketbaseAuth";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

describe("PocketbaseAuth", () => {
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
});

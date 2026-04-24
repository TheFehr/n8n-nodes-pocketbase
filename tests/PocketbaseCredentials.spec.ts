import { describe, it, expect, vi, beforeEach } from "vitest";
import { PocketbaseHttpApi } from "../credentials/PocketbaseHttpApi.credentials";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

describe("PocketbaseHttpApi Credentials", () => {
  let credentialsType: PocketbaseHttpApi;
  let mockHttpRequestHelper: any;

  beforeEach(() => {
    credentialsType = new PocketbaseHttpApi();
    mockHttpRequestHelper = {
      helpers: {
        httpRequest: vi.fn(),
      },
    };
  });

  it("should perform login in preAuthentication", async () => {
    const credentials = {
      url: "http://localhost:8090",
      username: "admin@example.com",
      password: "password123",
    } as unknown as ICredentialDataDecryptedObject;

    mockHttpRequestHelper.helpers.httpRequest.mockResolvedValue({ token: "mock-jwt-token" });

    const result = await credentialsType.preAuthentication.call(
      mockHttpRequestHelper as unknown as IHttpRequestHelper,
      credentials,
    );

    expect(result).toEqual({ jwtToken: "mock-jwt-token" });
    expect(mockHttpRequestHelper.helpers.httpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
      body: {
        identity: "admin@example.com",
        password: "password123",
      },
    });
  });

  it("should handle trailing slash in URL", async () => {
    const credentials = {
      url: "http://localhost:8090/",
      username: "admin@example.com",
      password: "password123",
    } as unknown as ICredentialDataDecryptedObject;

    mockHttpRequestHelper.helpers.httpRequest.mockResolvedValue({ token: "mock-jwt-token" });

    await credentialsType.preAuthentication.call(
      mockHttpRequestHelper as unknown as IHttpRequestHelper,
      credentials,
    );

    expect(mockHttpRequestHelper.helpers.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
      }),
    );
  });
});

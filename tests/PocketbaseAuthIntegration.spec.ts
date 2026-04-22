import { describe, it, expect, beforeEach } from "vitest";
import { login, refresh, inFlightRequests } from "../nodes/Common/PocketbaseAuth";
import type { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

const runIntegration = process.env.RUN_POCKETBASE_INTEGRATION === "true";

describe.skipIf(!runIntegration)("PocketbaseAuth Integration", () => {
  beforeEach(() => {
    inFlightRequests.clear();
  });

  const baseUrl = process.env.POCKETBASE_TEST_URL || "http://localhost:8090";
  const email = process.env.POCKETBASE_TEST_USER || "test@example.com";
  const oldPassword = process.env.POCKETBASE_TEST_PASS || "password123";
  const newPassword = "newPassword123";

  it("should refresh token, and fall back to login if password changed", async () => {
    // 1. Initial Login to get a valid token
    const authRes = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password: oldPassword }),
    });
    expect(authRes.ok).toBe(true);
    const { token: initialToken, record } = (await authRes.json()) as any;

    // 2. Setup mock 'this' for our refresh call
    // We want to test our actual 'refresh' implementation,
    // but we need to provide a mock 'httpRequest' helper that uses real fetch.
    const mockThis = {
      helpers: {
        httpRequest: async (options: any) => {
          const headers: Record<string, string> = { ...options.headers };
          let body = options.body;

          if (
            body &&
            typeof body === "object" &&
            !(body instanceof Buffer) &&
            !(typeof body.append === "function" && typeof body.getHeaders === "function")
          ) {
            body = JSON.stringify(body);
            if (!headers["Content-Type"]) {
              headers["Content-Type"] = "application/json";
            }
          }

          const res = await fetch(options.url, {
            method: options.method,
            headers,
            body,
          });

          const data = (await res.json()) as any;
          if (!res.ok) {
            // n8n's httpRequest helper usually throws on non-2xx
            const error: any = new Error(data.message || "Request failed");
            error.status = res.status;
            throw error;
          }
          return data;
        },
      },
    } as unknown as IHttpRequestHelper;

    let finalResultToken: string | undefined;

    try {
      // 3. Verify normal refresh works
      const credentials = {
        url: baseUrl,
        username: email,
        password: oldPassword,
        token: initialToken,
      } as unknown as ICredentialDataDecryptedObject;

      const refreshResult = await refresh.call(mockThis, credentials);
      expect(refreshResult.token).toBeDefined();
      const middleToken = refreshResult.token;

      // 4. Change password directly in PocketBase
      const updateRes = await fetch(`${baseUrl}/api/collections/_superusers/records/${record.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: middleToken,
        },
        body: JSON.stringify({
          password: newPassword,
          passwordConfirm: newPassword,
        }),
      });
      expect(updateRes.ok).toBe(true);

      // 5. Call refresh with the now-invalid token and the NEW password
      // We use an "expired" token to force isTokenExpired() to return true
      const expiredTime = Math.floor(Date.now() / 1000) - 3600;
      const expiredPayload = Buffer.from(JSON.stringify({ exp: expiredTime }))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const forcedExpiredToken = `header.${expiredPayload}.signature`;

      const credentialsWithNewPass = {
        url: baseUrl,
        username: email,
        password: newPassword,
        token: forcedExpiredToken,
      } as unknown as ICredentialDataDecryptedObject;

      const finalResult = await refresh.call(mockThis, credentialsWithNewPass);
      expect(finalResult.token).toBeDefined();
      expect(finalResult.token).not.toBe(middleToken);
      expect(finalResult.token).not.toBe(forcedExpiredToken);
      finalResultToken = finalResult.token;

      // 6. Verify the new token actually works
      const finalVerifyRes = await fetch(`${baseUrl}/api/collections/_superusers/auth-refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: finalResult.token,
        },
      });
      expect(finalVerifyRes.ok).toBe(true);
    } finally {
      // 7. Revert password back for other tests if needed
      if (record && record.id) {
        let cleanupToken = finalResultToken;

        if (!cleanupToken) {
          try {
            // Re-authenticate to get a fresh token if everything else failed
            const authRes = await fetch(
              `${baseUrl}/api/collections/_superusers/auth-with-password`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identity: email, password: newPassword }),
              },
            );
            if (authRes.ok) {
              const data = (await authRes.json()) as any;
              cleanupToken = data.token;
            } else {
              // Try with old password just in case it didn't change
              const authResOld = await fetch(
                `${baseUrl}/api/collections/_superusers/auth-with-password`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ identity: email, password: oldPassword }),
                },
              );
              if (authResOld.ok) {
                const data = (await authResOld.json()) as any;
                cleanupToken = data.token;
              }
            }
          } catch (err) {
            console.warn("Authentication cleanup failed to re-auth", err);
          }
        }

        if (cleanupToken) {
          const cleanupRes = await fetch(
            `${baseUrl}/api/collections/_superusers/records/${record.id}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: cleanupToken,
              },
              body: JSON.stringify({
                password: oldPassword,
                passwordConfirm: oldPassword,
              }),
            },
          );

          if (!cleanupRes.ok) {
            console.warn("Failed to revert password during cleanup:", await cleanupRes.text());
          }
        } else {
          console.warn("Skipping cleanup: No valid token available");
        }
      }
    }
  }, 20000);

  it("should deduplicate multiple concurrent login calls to the same PocketBase instance", async () => {
    let httpRequestCount = 0;

    const mockThis = {
      helpers: {
        httpRequest: async (options: any) => {
          httpRequestCount++;
          // Simulate some network latency to ensure calls overlap
          await new Promise((resolve) => setTimeout(resolve, 100));

          const res = await fetch(options.url, {
            method: options.method,
            headers: { "Content-Type": "application/json", ...options.headers },
            body: JSON.stringify(options.body),
          });

          const data = (await res.json()) as any;
          if (!res.ok) {
            const error: any = new Error(data.message || "Request failed");
            error.status = res.status;
            throw error;
          }
          return data;
        },
      },
    } as unknown as IHttpRequestHelper;

    const credentials = {
      url: baseUrl,
      username: email,
      password: oldPassword,
    } as unknown as ICredentialDataDecryptedObject;

    // Execute 5 logins concurrently
    const results = await Promise.all([
      login.call(mockThis, credentials),
      login.call(mockThis, credentials),
      login.call(mockThis, credentials),
      login.call(mockThis, credentials),
      login.call(mockThis, credentials),
    ]);

    // Verify only 1 HTTP request was made
    expect(httpRequestCount).toBe(1);

    // Verify all returned a valid token
    results.forEach((res) => {
      expect(res.token).toBeDefined();
      expect(typeof res.token).toBe("string");
    });

    // Verify the token actually works
    const verifyRes = await fetch(`${baseUrl}/api/collections/_superusers/auth-refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: results[0].token,
      },
    });
    expect(verifyRes.ok).toBe(true);
  }, 10000);
});

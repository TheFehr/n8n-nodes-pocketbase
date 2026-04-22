import { createHash } from "node:crypto";
import { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

interface Credentials {
  url: string;
  username: string;
  password: string;
}

function isTokenExpired(token: string): boolean {
  if (!token) return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8")) as { exp: number };

    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return true;
    }

    // Refresh if it's going to expire in less than 5 minutes
    return Date.now() / 1000 > payload.exp - 300;
  } catch {
    return true;
  }
}

// Memory cache for in-flight authentication requests to prevent race conditions
/**
 * A Map to track in-flight authentication requests to prevent redundant logins.
 * This is exported primarily to allow test suites to inspect or clear the state.
 * @internal
 * @testing
 */
export const inFlightRequests = new Map<string, Promise<{ token: string }>>();

/**
 * Generates a unique key for the given credentials to deduplicate requests.
 * Uses a SHA-256 hash of a canonical JSON representation to avoid storing raw passwords in keys.
 */
function getCredentialFingerprint(credentials: Credentials): string {
  const normalizedUrl = (credentials.url || "").replace(/\/$/, "");
  const canonical = JSON.stringify({
    url: normalizedUrl,
    username: credentials.username || "",
    password: credentials.password || "",
  });

  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Internal function to perform the actual login request.
 * Does not include deduplication logic.
 */
async function executeLogin(
  this: IHttpRequestHelper,
  url: string,
  creds: Credentials,
): Promise<{ token: string }> {
  const normalizedUrl = url.endsWith("/") ? url.slice(0, -1) : url;

  const { token } = (await this.helpers.httpRequest({
    method: "POST",
    url: `${normalizedUrl}/api/collections/_superusers/auth-with-password`,
    body: {
      identity: creds.username,
      password: creds.password,
    },
  })) as { token: string };

  return { token };
}

function validateCredentials(credentials: ICredentialDataDecryptedObject): Credentials {
  if (typeof credentials !== "object" || credentials === null) {
    throw new Error("Credentials must be an object");
  }

  const creds = credentials as unknown as Credentials;
  const { username, password, url } = creds;

  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("PocketBase URL is missing or invalid in Credentials");
  }
  if (typeof username !== "string" || username.trim() === "") {
    throw new Error("PocketBase Admin username is missing or invalid in Credentials");
  }
  if (typeof password !== "string" || password.trim() === "") {
    throw new Error("PocketBase Admin password is missing or invalid in Credentials");
  }

  return creds;
}

export async function login(
  this: IHttpRequestHelper,
  credentials: ICredentialDataDecryptedObject,
): Promise<{ token: string }> {
  const creds = validateCredentials(credentials);
  const { url } = creds;

  const fingerprint = getCredentialFingerprint(creds);
  const existingRequest = inFlightRequests.get(fingerprint);

  if (existingRequest) {
    return await existingRequest;
  }

  const loginPromise = executeLogin.call(this, url, creds);
  inFlightRequests.set(fingerprint, loginPromise);

  try {
    return await loginPromise;
  } finally {
    inFlightRequests.delete(fingerprint);
  }
}

export async function refresh(
  this: IHttpRequestHelper,
  credentials: ICredentialDataDecryptedObject,
): Promise<{ token: string }> {
  const creds = validateCredentials(credentials);
  const { url, token: existingToken } = credentials as unknown as Credentials & { token: string };

  if (!isTokenExpired(existingToken)) {
    return { token: existingToken };
  }

  const fingerprint = getCredentialFingerprint(creds);
  const existingRequest = inFlightRequests.get(fingerprint);

  if (existingRequest) {
    return await existingRequest;
  }

  const refreshFn = async () => {
    const normalizedUrl = url.endsWith("/") ? url.slice(0, -1) : url;

    try {
      const { token } = (await this.helpers.httpRequest({
        method: "POST",
        url: `${normalizedUrl}/api/collections/_superusers/auth-refresh`,
        headers: {
          Authorization: existingToken,
        },
      })) as { token: string };
      return { token };
    } catch (error) {
      const err = error as Record<string, unknown> | null;
      const httpCode = Number(err?.httpCode || err?.status);
      if (httpCode === 401 || httpCode === 403 || httpCode === 404) {
        // Fallback to login if refresh fails.
        // We use executeLogin directly to avoid deadlocking on the fingerprint lock we currently hold.
        return await executeLogin.call(this, url, creds);
      }
      throw error;
    }
  };

  const refreshPromise = refreshFn();

  inFlightRequests.set(fingerprint, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    inFlightRequests.delete(fingerprint);
  }
}

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

export async function login(
  this: IHttpRequestHelper,
  credentials: ICredentialDataDecryptedObject,
): Promise<{ token: string }> {
  if (typeof credentials !== "object" || credentials === null) {
    throw new Error("Credentials must be an object");
  }

  const { username, password, url } = credentials as unknown as Credentials;

  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("PocketBase URL is missing or invalid in Credentials");
  }
  if (typeof username !== "string" || username.trim() === "") {
    throw new Error("PocketBase Admin username is missing or invalid in Credentials");
  }
  if (typeof password !== "string" || password.trim() === "") {
    throw new Error("PocketBase Admin password is missing or invalid in Credentials");
  }

  const normalizedUrl = url.endsWith("/") ? url.slice(0, -1) : url;

  const { token } = (await this.helpers.httpRequest({
    method: "POST",
    url: `${normalizedUrl}/api/collections/_superusers/auth-with-password`,
    body: {
      identity: username,
      password,
    },
  })) as { token: string };
  return { token };
}

export async function refresh(
  this: IHttpRequestHelper,
  credentials: ICredentialDataDecryptedObject,
): Promise<{ token: string }> {
  const {
    url,
    username,
    password,
    token: existingToken,
  } = credentials as unknown as Credentials & { token: string };

  const canReauthenticate = !!(username && password);

  if (!isTokenExpired(existingToken)) {
    return { token: existingToken };
  }

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
    if (
      canReauthenticate &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      return await login.call(this, credentials);
    }
    throw error;
  }
}

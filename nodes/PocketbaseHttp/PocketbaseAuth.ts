import { IHttpRequestHelper, ICredentialDataDecryptedObject } from "n8n-workflow";

interface Credentials {
  url: string;
  username: string;
  password: string;
}

export async function login(
  this: IHttpRequestHelper,
  credentials: ICredentialDataDecryptedObject,
): Promise<{ token: string }> {
  const { username, password, url } = credentials as unknown as Credentials;

  const { token } = (await this.helpers.httpRequest({
    method: "POST",
    url: `${url.endsWith("/") ? url.slice(0, -1) : url}/api/collections/_superusers/auth-with-password`,
    body: {
      identity: username,
      password,
    },
  })) as { token: string };
  return { token };
}

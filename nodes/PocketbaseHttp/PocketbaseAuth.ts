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
	if (typeof credentials !== 'object' || credentials === null) {
		throw new Error('Credentials must be an object');
	}

	const { username, password, url } = credentials as unknown as Credentials;

	if (typeof url !== 'string' || url.trim() === '') {
		throw new Error('PocketBase URL is missing or invalid in Credentials');
	}
	if (typeof username !== 'string' || username.trim() === '') {
		throw new Error('PocketBase Admin username is missing or invalid in Credentials');
	}
	if (typeof password !== 'string' || password.trim() === '') {
		throw new Error('PocketBase Admin password is missing or invalid in Credentials');
	}

	const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

	const { token } = (await this.helpers.httpRequest({
		method: 'POST',
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
	const { url, token: existingToken } = credentials as unknown as Credentials & { token: string };
	const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

	try {
		const { token } = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${normalizedUrl}/api/collections/_superusers/auth-refresh`,
			headers: {
				Authorization: existingToken,
			},
		})) as { token: string };
		return { token };
	} catch (error) {
		if (error.status === 401 || error.status === 403 || error.status === 404) {
			return await login.call(this, credentials);
		}
		throw error;
	}
}

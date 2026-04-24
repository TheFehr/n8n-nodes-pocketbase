import {
  IAuthenticate,
  IconFile,
  ICredentialDataDecryptedObject,
  ICredentialTestRequest,
  ICredentialType,
  IHttpRequestHelper,
  INodeProperties,
} from "n8n-workflow";

export class PocketbaseHttpApi implements ICredentialType {
  name = "pocketbaseHttpApi";
  displayName = "PocketBase HTTP API";
  documentationUrl = "https://pocketbase.io/docs/authentication/";
  properties: INodeProperties[] = [
    {
      displayName: "URL",
      name: "url",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Admin (_superusers) username",
      name: "username",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Admin (_superusers) password",
      name: "password",
      type: "string",
      typeOptions: {
        password: true,
      },
      default: "",
      required: true,
    },
    {
      displayName: "JWT Token",
      name: "jwtToken",
      type: "hidden",
      typeOptions: {
        expirable: true,
      },
      default: "",
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials?.url?.replace(/\\/$/, '')}}",
      url: "=/api/collections/_superusers/auth-with-password",
      method: "POST",
      body: {
        identity: "={{$credentials?.username}}",
        password: "={{$credentials?.password}}",
      },
    },
    rules: [
      {
        type: "responseCode",
        properties: {
          value: 200,
          message: "Test",
        },
      },
      {
        type: "responseCode",
        properties: {
          value: 400,
          message: "An error occurred during login",
        },
      },
    ],
  };

  async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
    const url = (credentials.url as string).replace(/\/$/, "");

    const { token } = (await this.helpers.httpRequest({
      method: "POST",
      url: `${url}/api/collections/_superusers/auth-with-password`,
      body: {
        identity: credentials.username,
        password: credentials.password,
      },
    })) as { token: string };

    return { jwtToken: token };
  }

  authenticate: IAuthenticate = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "={{ $credentials.jwtToken }}",
      },
    },
  };

  icon = "file:pocketbase.svg" as IconFile;
}

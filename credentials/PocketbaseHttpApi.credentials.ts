import {
  IAuthenticate,
  IconFile,
  ICredentialDataDecryptedObject,
  ICredentialTestRequest,
  ICredentialType,
  IHttpRequestHelper,
  INodeProperties,
} from "n8n-workflow";
import { login } from "../nodes/PocketbaseHttp/PocketbaseAuth";

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
      displayName: "Session Token",
      name: "token",
      type: "hidden",
      typeOptions: {
        expirable: true,
        password: true,
      },
      default: "",
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials?.url}}",
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
    return await login.call(this, credentials);
  }

  authenticate: IAuthenticate = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "={{ $credentials.token }}",
      },
    },
    // @ts-ignore
    on_error: {
      rules: [
        {
          type: "responseCode",
          properties: {
            value: 401, // Token expired or invalid
          },
        },
        {
          type: "responseCode",
          properties: {
            value: 403, // Permission denied / Invalidated session
          },
        },
        {
          type: "responseCode",
          properties: {
            value: 404, // "Missing auth record context" - triggers re-auth
          },
        },
      ],
    },
  };

  icon = "file:pocketbase.svg" as IconFile;
}

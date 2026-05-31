import {
  IconFile,
  ICredentialTestRequest,
  ICredentialType,
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

  icon = "file:pocketbase.svg" as IconFile;
}

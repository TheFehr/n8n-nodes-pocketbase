// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import FormData from "form-data";
import {
  AssignmentCollectionValue,
  IDataObject,
  IExecuteSingleFunctions,
  IHttpRequestOptions,
} from "n8n-workflow";

export async function prepareRequestBody(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const bodyType = this.getNodeParameter("bodyType", ["fields"]) as string[];

  const formData = new FormData();

  if (bodyType.includes("fields")) {
    (
      this.getNodeParameter("fields", {
        assignments: [],
      }) as AssignmentCollectionValue
    )?.assignments?.forEach(function ({ name, value }) {
      if (!name || typeof name !== "string" || name.trim() === "") {
        return;
      }
      if (value !== undefined && value !== null) {
        const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
        formData.append(name, stringValue);
      }
    });
  }

  if (bodyType.includes("bodyJson")) {
    const bodyJson = this.getNodeParameter("bodyJson", "{}") as string | IDataObject;
    try {
      const body = typeof bodyJson === "string" ? (JSON.parse(bodyJson) as IDataObject) : bodyJson;

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new Error("JSON Body must be a JSON object");
      }

      Object.entries(body).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          return;
        }
        const val = typeof value === "object" ? JSON.stringify(value) : String(value);
        formData.append(key, val);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON in JSON Body parameter: ${message}`);
    }
  }

  if (bodyType.includes("binaryData")) {
    await handleBinaryData.apply(this, [formData]);
  }

  if (!requestOptions.headers) {
    requestOptions.headers = {};
  }
  Object.assign(requestOptions.headers, formData.getHeaders());

  requestOptions.body = formData;
  const loggedBody = "[multipart body omitted]";
  this.logger.info(`Request URL: ${requestOptions.url} | ${loggedBody}`);

  return requestOptions;
}

async function handleBinaryData(this: IExecuteSingleFunctions, formData: FormData) {
  const binaryPropertyName = this.getNodeParameter("binaryPropertyName", undefined) as string;

  if (!binaryPropertyName) {
    throw new Error("Binary data selected but no property name provided. Please specify which binary property to use.");
  }

  const binaryFieldName = this.getNodeParameter("binaryFieldName", "") as string;
  const fieldName = binaryFieldName || "file";
  this.logger.info(
    "Adding binary data to request formData from property: " +
      binaryPropertyName +
      "\nat: " +
      fieldName,
  );

  const binaryData = this.helpers.assertBinaryData(binaryPropertyName);
  const dataBuffer = await this.helpers.getBinaryDataBuffer(binaryPropertyName);

  formData.append(fieldName, dataBuffer, {
    contentType: binaryData.mimeType,
    filename: binaryData.fileName,
  });
}

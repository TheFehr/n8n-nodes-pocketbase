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
  const hasBinary = bodyType.includes("binaryData");

  if (!hasBinary) {
    // Standard JSON approach
    const body: IDataObject = {};

    if (bodyType.includes("fields")) {
      const fields = this.getNodeParameter("fields", { assignments: [] }) as AssignmentCollectionValue;
      fields?.assignments?.forEach(({ name, value }) => {
        if (name && typeof name === "string" && name.trim() !== "" && value !== undefined && value !== null) {
          body[name] = value;
        }
      });
    }

    if (bodyType.includes("bodyJson")) {
      const bodyJson = this.getNodeParameter("bodyJson", "{}") as string | IDataObject;
      const parsedBody = parseBodyJson(bodyJson);
      Object.assign(body, parsedBody);
    }

    requestOptions.body = body;
    this.logger.info(`Request URL: ${requestOptions.url} | [JSON body]`);
    return requestOptions;
  }

  // Multipart/form-data approach (required for binary/files)
  const formData = new FormData();

  if (bodyType.includes("fields")) {
    (this.getNodeParameter("fields", { assignments: [] }) as AssignmentCollectionValue)
      ?.assignments?.forEach(({ name, value }) => {
        if (name && typeof name === "string" && name.trim() !== "" && value !== undefined && value !== null) {
          const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
          formData.append(name, stringValue);
        }
      });
  }

  if (bodyType.includes("bodyJson")) {
    const bodyJson = this.getNodeParameter("bodyJson", "{}") as string | IDataObject;
    const parsedBody = parseBodyJson(bodyJson);
    Object.entries(parsedBody).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        const val = typeof value === "object" ? JSON.stringify(value) : String(value);
        formData.append(key, val);
      }
    });
  }

  await handleBinaryData.apply(this, [formData]);

  if (!requestOptions.headers) requestOptions.headers = {};
  Object.assign(requestOptions.headers, formData.getHeaders());
  requestOptions.body = formData;

  this.logger.info(`Request URL: ${requestOptions.url} | [multipart body]`);
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

function parseBodyJson(bodyJson: string | IDataObject): IDataObject {
  let parsed: any;
  if (typeof bodyJson === "string") {
    try {
      parsed = JSON.parse(bodyJson);
    } catch (error) {
      throw new Error(`Invalid JSON in Body: ${error.message}`);
    }
  } else {
    parsed = bodyJson;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON Body must be a JSON object");
  }

  return parsed as IDataObject;
}

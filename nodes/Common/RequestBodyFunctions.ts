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
      const fields = this.getNodeParameter("fields", {
        assignments: [],
      }) as AssignmentCollectionValue;
      fields?.assignments?.forEach(({ name, value }) => {
        if (
          name &&
          typeof name === "string" &&
          name.trim() !== "" &&
          value !== undefined
        ) {
          const key = name.trim();
          body[key] = value;
        }
      });
    }

    if (bodyType.includes("bodyJson")) {
      const bodyJson = this.getNodeParameter("bodyJson", "{}") as string | Record<string, unknown>;
      const parsedBody = parseBodyJson(bodyJson);
      const filteredParsedBody: IDataObject = {};
      Object.entries(parsedBody).forEach(([key, value]) => {
        if (
          key &&
          typeof key === "string" &&
          key.trim() !== "" &&
          value !== undefined
        ) {
          const trimmedKey = key.trim();
          filteredParsedBody[trimmedKey] = value;
        }
      });
      Object.assign(body, filteredParsedBody);
    }

    requestOptions.body = body;
    this.logger.debug(`Request URL: ${requestOptions.url} | [JSON body]`);
    return requestOptions;
  }

  // Multipart/form-data approach (required for binary/files)
  const formData = new FormData();

  if (bodyType.includes("fields")) {
    (
      this.getNodeParameter("fields", { assignments: [] }) as AssignmentCollectionValue
    )?.assignments?.forEach(({ name, value }) => {
      if (
        name &&
        typeof name === "string" &&
        name.trim() !== "" &&
        value !== undefined
      ) {
        const key = name.trim();
        const stringValue = (value === null) ? "null" : (typeof value === "object" ? JSON.stringify(value) : String(value));
        formData.append(key, stringValue);
      }
    });
  }

  if (bodyType.includes("bodyJson")) {
    const bodyJson = this.getNodeParameter("bodyJson", "{}") as string | Record<string, unknown>;
    const parsedBody = parseBodyJson(bodyJson);
    Object.entries(parsedBody).forEach(([key, value]) => {
      if (
        key &&
        typeof key === "string" &&
        key.trim() !== "" &&
        value !== undefined
      ) {
        const trimmedKey = key.trim();
        const val = (value === null) ? "null" : (typeof value === "object" ? JSON.stringify(value) : String(value));
        formData.append(trimmedKey, val);
      }
    });
  }

  await handleBinaryData.apply(this, [formData]);

  if (!requestOptions.headers) {
    requestOptions.headers = {};
  } else {
    // Remove existing Content-Type to avoid collisions with multipart boundary
    Object.keys(requestOptions.headers).forEach((key) => {
      if (key.toLowerCase() === "content-type") {
        delete requestOptions.headers![key];
      }
    });
  }

  Object.assign(requestOptions.headers, formData.getHeaders());
  requestOptions.body = formData;

  this.logger.debug(`Request URL: ${requestOptions.url} | [multipart body]`);
  return requestOptions;
}

async function handleBinaryData(this: IExecuteSingleFunctions, formData: FormData) {
  const binaryPropertyName = (
    (this.getNodeParameter("binaryPropertyName", undefined) as string) || ""
  ).trim();

  if (!binaryPropertyName) {
    throw new Error(
      "Binary data selected but no property name provided. Please specify which binary property to use.",
    );
  }

  const binaryFieldName = ((this.getNodeParameter("binaryFieldName", "") as string) || "").trim();
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

function parseBodyJson(bodyJson: string | Record<string, unknown>): Record<string, unknown> {
  if (
    typeof bodyJson !== "string" &&
    (typeof bodyJson !== "object" || bodyJson === null || Array.isArray(bodyJson))
  ) {
    throw new Error("JSON Body must be a JSON object or string");
  }

  let parsed: unknown;
  if (typeof bodyJson === "string") {
    try {
      parsed = JSON.parse(bodyJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in Body: ${message}`);
    }
  } else {
    parsed = bodyJson;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON Body must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import FormData from "form-data";
import {
  AssignmentCollectionValue,
  IExecuteSingleFunctions,
  IHttpRequestOptions,
} from "n8n-workflow";

export async function prepareRequestBody(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
) {
  const bodyType = this.getNodeParameter("bodyType", ["parameters"]) as string[];

  const formData = new FormData();

  if (bodyType.includes("fields")) {
    (
      this.getNodeParameter("fields", {
        assignments: [],
      }) as AssignmentCollectionValue
    )?.assignments?.forEach(function ({ name, value }) {
      formData.append(name, value);
    });
  }

  if (bodyType.includes("bodyJson")) {
    if (typeof requestOptions.body === "object" && requestOptions.body !== null) {
      Object.entries(requestOptions.body).forEach(([key, value]) => {
        const val = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
        formData.append(key, val);
      });
    } else if (requestOptions.body !== undefined) {
      formData.append("body", requestOptions.body);
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
  const isMultipart =
    requestOptions.body instanceof FormData ||
    (requestOptions.headers &&
      requestOptions.headers["content-type"]?.toString().includes("multipart"));
  const loggedBody = isMultipart ? "[multipart body omitted]" : JSON.stringify(requestOptions.body);
  this.logger.info(`Request URL: ${requestOptions.url} | ${loggedBody}`);

  return requestOptions;
}

async function handleBinaryData(this: IExecuteSingleFunctions, formData: FormData) {
  const binaryPropertyName = this.getNodeParameter("binaryPropertyName", undefined) as string;

  if (!binaryPropertyName) {
    this.logger.info("No binary data to send. Skipping...");
    return;
  }

  const binaryFieldName = this.getNodeParameter("binaryFieldName", undefined) as string;
  this.logger.info(
    "Adding binary data to request formData from property: " +
      binaryPropertyName +
      "\nat: " +
      binaryFieldName,
  );

  const binaryData = this.helpers.assertBinaryData(binaryPropertyName);
  const dataBuffer = await this.helpers.getBinaryDataBuffer(binaryPropertyName);

  formData.append(binaryFieldName, dataBuffer, {
    contentType: binaryData.mimeType,
    filename: binaryData.fileName,
  });
}

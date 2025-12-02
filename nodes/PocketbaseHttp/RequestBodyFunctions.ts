// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import FormData from 'form-data';
import {
	AssignmentCollectionValue,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
} from 'n8n-workflow';

export async function prepareRequestBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
) {
	const bodyType = this.getNodeParameter('bodyType', ['parameters']) as string[];

	const formData = new FormData();

	if (bodyType.includes('fields')) {
		(
			this.getNodeParameter('fields', {
				assignments: [],
			}) as AssignmentCollectionValue
		).assignments.forEach(function ({ name, value }) {
			formData.append(name, value);
		});
	}

	if (bodyType.includes('bodyJson')) {
			Object.entries(requestOptions.body).forEach(([key, value]) => {
				formData.append(key, value);
			});
	}

	if (bodyType.includes('binaryData')) {
		await handleBinaryData.apply(this, [formData]);
	}

	if (!requestOptions.headers) {
		requestOptions.headers = {};
	}
	requestOptions.headers['Content-Type'] = 'multipart/form-data';

	requestOptions.body = formData;
	this.logger.info(`Request URL: ${requestOptions.url} | ${JSON.stringify(requestOptions.body)}`);

	return requestOptions;
}

async function handleBinaryData(this: IExecuteSingleFunctions, formData: FormData) {
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', undefined) as string;

	if (!binaryPropertyName) {
		this.logger.info('No binary data to send. Skipping...');
		return;
	}

	const binaryFieldName = this.getNodeParameter('binaryFieldName', undefined) as string;
	this.logger.info(
		'Adding binary data to request formData from property: ' +
			binaryPropertyName +
			'\nat: ' +
			binaryFieldName,
	);

	const binaryData = this.helpers.assertBinaryData(binaryPropertyName);
	const dataBuffer = await this.helpers.getBinaryDataBuffer(binaryPropertyName);

	formData.append(binaryFieldName, dataBuffer, {
		contentType: binaryData.mimeType,
		filename: binaryData.fileName,
	});
}

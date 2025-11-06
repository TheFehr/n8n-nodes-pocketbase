import { IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow';

export async function recordUpdatePreSendAction(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	requestOptions.body = (requestOptions.body ?? {}) as object;

	const parameters = this.getNodeParameter('bodyParameters.parameters', {}) as object;
	this.logger.error(JSON.stringify(parameters));
	Object.entries(parameters).forEach(([, entry]) => {
		const {name, value} = entry;
		Object.assign(requestOptions.body, {[name]: value});
	});
	this.logger.error(JSON.stringify(requestOptions.body));

	return requestOptions;
}

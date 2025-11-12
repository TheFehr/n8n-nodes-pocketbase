import {
	DeclarativeRestApiSettings,
	IDataObject,
	IExecutePaginationFunctions,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
} from 'n8n-workflow';

function prepareRequestBody(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions) {
	requestOptions.body = (requestOptions.body ?? {}) as object;

	const parameters = this.getNodeParameter('bodyParameters.parameters', {}) as object;
	Object.entries(parameters).forEach(([, entry]) => {
		const { name, value } = entry;
		Object.assign(requestOptions.body, { [name]: value });
	});

	return requestOptions;
}

export async function recordViewPreSendAction(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	return requestOptions;
}

export async function recordViewPostReceiveAction(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	return items;
}

export async function recordUpdatePreSendAction(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	return prepareRequestBody.call(this, requestOptions);
}

export async function recordCreatePreSendAction(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	return prepareRequestBody.call(this, requestOptions);
}

export async function pagination(
	this: IExecutePaginationFunctions,
	requestOptions: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
	const allIsActive = this.getNodeParameter('parameters.allElements', false) as boolean;
	let executions: INodeExecutionData[] = [];
	let page: number = this.getNodeParameter('parameters.page', 1) as number;
	let totalPages: number = page + 1;
	requestOptions.options.qs ??= {};

	do {
		requestOptions.options.qs.page = page;
		const responseData = await this.makeRoutingRequest(requestOptions);
		page = responseData[0].json.page as number;
		if (allIsActive) {
			totalPages = responseData[0].json.totalPages as number;
		}
		executions = executions.concat(
			(responseData[0].json.items as IDataObject[]).map((item) => ({ json: item })),
		);
		page++;
	} while (page < totalPages);

	return executions;
}

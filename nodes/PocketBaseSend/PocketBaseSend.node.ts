import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

import PocketBaseSDK from 'pocketbase';

interface Credentials {
	url: string;
	userCollection: string;
	username: string;
	password: string;
}

export class PocketBaseSend implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PocketBase - Send',
		name: 'pocketBaseSend',
		icon: 'file:pocketbase.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["path"]}}',
		description: 'Consume custom PocketBase API',
		defaults: {
			name: 'PocketBase - Send',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'pocketBaseApi',
				required: true,
			},
		],

		properties: [
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				required: true,
				description: 'The path of the custom api endpoint'
			},
			{
				displayName: 'Send Options',
				name: 'sendOptions',
				type: 'json',
				default: '',
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData = [];
		const auth = await this.getCredentials('pocketBaseApi', 0) as unknown as Credentials;

		const pb = new PocketBaseSDK(auth.url);
		await pb.collection(auth.userCollection).authWithPassword(auth.username, auth.password);
		if (!pb.authStore.isValid) {
			throw new NodeOperationError(this.getNode(), `Authentication failed!`);
		}
		const path = this.getNodeParameter('path', 0) as string;
		const sendOptions = this.getNodeParameter('sendOptions', 0) as object;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				let elementData = await pb.send(path, sendOptions);
				returnData.push(elementData);
			} catch (error) {
				if (this.continueOnFail()) {
					const inputData = this.getInputData(itemIndex);
					if (inputData && inputData.length > 0) {
						items.push({json: inputData[0].json, error, pairedItem: itemIndex});
					} else {
						items.push({json: {}, error, pairedItem: itemIndex});
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Something went wrong:<br>${JSON.stringify(error.response)}`,
						{itemIndex}
					);

				}
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}

import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';

import PocketBaseSDK, {RecordListQueryParams} from 'pocketbase';
import Client from "pocketbase";

interface Credentials {
	url: string;
	userCollection: string;
	username: string;
	password: string;
}

export class PocketBase implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PocketBase',
		name: 'pocketBase',
		icon: 'file:pocketbase.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + " " + $parameter["resource"]}}',
		description: 'Consume PocketBase API',
		defaults: {
			name: 'PocketBase',
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
				displayName: 'Resource',
				name: 'resource',
				type: 'string',
				default: '',
				required: true,
				description: 'The Resource (PB: Collection) you are working on/with'
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{
						name: 'List/Search',
						value: 'search',
						action: 'List or search your collection'
					},
					{
						name: 'View',
						value: 'view',
						action: 'View an element in your collection'
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create an element in your collection'
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update an element in your collection'
					}
				],
				default: 'search',
				required: true,
				noDataExpression: true
			},
			{
				displayName: 'Element ID',
				name: 'elementId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: [
							'view', 'update'
						]
					}
				}
			},
			{
				displayName: 'Parameters',
				name: 'parameters',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Elements per Page',
						name: 'elementsPerPage',
						type: 'number',
						typeOptions: {
							minValue: 1
						},
						default: 30
					},
					{
						displayName: 'Expand',
						name: 'expand',
						type: 'string',
						default: ''
					},
					{
						displayName: 'Filter',
						name: 'filter',
						type: 'string',
						default: ''
					},

					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						typeOptions: {
							minValue: 1
						},
						default: 1
					},
					{
						displayName: 'Sort',
						name: 'sort',
						type: 'string',
						default: ''
					}
				]
			},
			{
				displayName: 'Body Parameters',
				name: 'bodyParameters',
				type: 'fixedCollection',
				displayOptions: {
					show: {
						operation: ['create', 'update']
					}
				},
				typeOptions: {
					multipleValues: true,
				},
				placeholder: 'Add Parameter',
				default: {
					parameters: [
						{
							name: '',
							value: '',
						},
					],
				},
				options: [
					{
						name: 'parameters',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								description:
									'ID of the field to set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code-examples/expressions/">expression</a>.',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Value of the field to set',
							},
						],
					},
				],
			}
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData = [];
		const auth = await this.getCredentials('pocketBaseApi', 0) as unknown as Credentials;
		const action = this.getNodeParameter('operation', 0) as string;

		const pb = new PocketBaseSDK(auth.url);
		await pb.collection(auth.userCollection).authWithPassword(auth.username, auth.password);
		if (!pb.authStore.isValid) {
			throw new NodeOperationError(this.getNode(), `Authentication failed!`);
		}
		const collection = this.getNodeParameter('resource', 0) as string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				let elementData;
				switch (action) {
					case 'search':
						elementData = await handleSearch(pb, this, collection, itemIndex);
						returnData.push(elementData);
						break;

					case 'view':
						elementData = await handleView(pb, this, collection, itemIndex);
						returnData.push(elementData);
						break;

					case 'update':
						elementData = await handleUpdate(pb, this, collection, itemIndex);
						returnData.push(elementData);
						break;

					case 'create':
						elementData = await handleCreate(pb, this, collection, itemIndex);
						returnData.push(elementData);
						break;
				}
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


async function handleSearch(pb: Client, context: IExecuteFunctions, collection: string, itemIndex: number): Promise<IDataObject> {
	const {page, elementsPerPage, ...parameters} = context.getNodeParameter('parameters', itemIndex) as RecordListQueryParams;
	const records = await pb.collection(collection).getList(page, elementsPerPage, parameters);

	return {
		...records
	} as IDataObject;
}


async function handleView(pb: Client, context: IExecuteFunctions, collection: string, itemIndex: number): Promise<IDataObject> {
	const elementId = context.getNodeParameter('elementId', itemIndex) as string;
	const record = await pb.collection(collection).getOne(elementId);

	return record as IDataObject;
}


async function handleUpdate(pb: Client, context: IExecuteFunctions, collection: string, itemIndex: number): Promise<IDataObject> {
	const elementId = context.getNodeParameter('elementId', itemIndex) as string;
	const data = context.getNodeParameter('bodyParameters.parameters', itemIndex) as BodyParameter[];
	const record = await pb.collection(collection).update(elementId, prepareRequestBody(data));

	return record as IDataObject;
}


async function handleCreate(pb: Client, context: IExecuteFunctions, collection: string, itemIndex: number): Promise<IDataObject> {
	const data = context.getNodeParameter('bodyParameters.parameters', itemIndex) as BodyParameter[];
	const record = await pb.collection(collection).create(prepareRequestBody(data));

	return record as IDataObject;
}

type BodyParameter = { name: string; value: string };
const prepareRequestBody = (
	parameters: BodyParameter[]
) => {
	return parameters.reduce((acc, entry) => {
		acc[entry.name] = entry.value;
		return acc;
	}, {} as IDataObject);
};

import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { recordUpdatePreSendAction } from './GenericFunctions';

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
		usableAsTool: true,
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Other Tools'],
			},
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pocketBaseApi',
				required: true,
			},
		],
		requestDefaults: {
			returnFullResponse: true,
			baseURL: '={{$credentials.url.replace(new RegExp("/$"), "")}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},

		properties: [
			{
				displayName: 'Collection Name or ID',
				name: 'resource',
				type: 'options',
				default: '',
				noDataExpression: true,
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getCollections',
				},
				description:
					'The Resource (PB: Collection) you are working on/with. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{
						name: 'List/Search',
						value: 'search',
						action: 'List or search your collection',
						routing: {
							request: {
								method: 'GET',
								url: '=/api/collections/{{$parameter["resource"]}}/records',
							}
						},
					},
					{
						name: 'View',
						value: 'view',
						action: 'View an element in your collection',
						routing: {
							request: {
								method: 'GET',
								url: `=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}`,
							}
						},
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create an element in your collection',
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update an element in your collection',
						routing: {
							request: {
								method: 'PATCH',
								url: `=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}`,
							},
							send: {
								preSend: [recordUpdatePreSendAction]
							}
						},
					},
				],
				default: 'search',
				required: true,
				noDataExpression: true,
			},
			{
				displayName: 'Element ID',
				name: 'elementId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['view', 'update'],
					},
				},
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
							minValue: 1,
						},
						default: 30,
					},
					{
						displayName: 'Expand',
						name: 'expand',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Filter',
						name: 'filter',
						type: 'string',
						default: '',
					},

					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 1,
					},
					{
						displayName: 'Sort',
						name: 'sort',
						type: 'string',
						default: '',
					},
				],
			},
			{
				displayName: 'Body Parameters',
				name: 'bodyParameters',
				type: 'fixedCollection',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
					},
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
			},
		],
	};

	methods = {
		loadOptions: {
			async getCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				const { url } = await this.getCredentials('pocketBaseApi');
				const { items } = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'pocketBaseApi',
					{
						url: `${url}/api/collections`,
						method: 'GET',
					},
				);

				items.forEach(({ id, name }: { id: string; name: string }) => {
					returnData.push({
						name,
						value: id,
					});
				});

				return returnData;
			},
		},
	};
}

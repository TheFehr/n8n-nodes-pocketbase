import {
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes
} from 'n8n-workflow';
import {
	pagination,
	recordCreatePreSendAction,
	recordUpdatePreSendAction,
	recordViewPostReceiveAction,
	recordViewPreSendAction,
} from './GenericFunctions';
import { LoadOptions } from './LoadOptions';

export class PocketbaseHttp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PocketBase',
		name: 'pocketbase',
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
							},
							output: {
								postReceive: [recordViewPostReceiveAction],
							},
							send: {
								preSend: [recordViewPreSendAction],
								paginate: true,
							},
							operations: { pagination },
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
							},
							send: {
								preSend: [recordViewPreSendAction],
							},
						},
					},
					{
						name: 'Create',
						value: 'create',
						action: 'Create an element in your collection',
						routing: {
							request: {
								method: 'POST',
								url: `=/api/collections/{{$parameter["resource"]}}/records`,
							},
							send: {
								preSend: [recordCreatePreSendAction],
							},
						},
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
								preSend: [recordUpdatePreSendAction],
							},
						},
					},
				],
				default: 'search',
				required: true,
				noDataExpression: true,
			},
			{
				displayName: 'Element Name or ID',
				name: 'elementId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsDependsOn: ['resource', 'parameters.fields'],
					loadOptionsMethod: 'getRows',
				},
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
						displayName: 'All Elements',
						name: 'allElements',
						type: 'boolean',
						default: false,
					},
					{
						displayName: 'Elements per Page',
						name: 'elementsPerPage',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 30,
						routing: {
							send: {
								type: 'query',
								property: 'perPage'
							},
						}
					},
					{
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
						displayName: 'Expand Relations',
						// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
						description:
							'Choose from the list, or specify the Name using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						name: 'relation',
						type: 'multiOptions',
						default: [],
						typeOptions: {
							loadOptionsMethod: 'getRelations',
						},
						routing: {
							request: {
								qs: {
									expand: '={{ $value ? $value.join(",") : undefined }}',
								},
							},
						},
					},
					{
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
						displayName: 'Field Names',
						// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
						description:
							'Choose from the list, or specify Names using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
						name: 'fields',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getFields',
						},
						default: [],
						routing: {
							request: {
								qs: {
									fields: '={{ $value ? $value.join(",") : undefined }}',
								},
							},
						},
					},
					{
						displayName: 'Filter',
						name: 'filter',
						type: 'string',
						default: '',
						routing: {
							send: {
								type: 'query',
								property: 'filter'
							},
						}
					},

					{
						displayName: 'Page',
						name: 'page',
						type: 'number',
						typeOptions: {
							minValue: 1,
						},
						default: 1,
						routing: {
							send: {
								type: 'query',
								property: 'page'
							},
						}
					},
					{
						displayName: 'Sort',
						name: 'sort',
						type: 'string',
						default: '',
						routing: {
							send: {
								type: 'query',
								property: 'sort'
							},
						}
					},
				],
			},
			{
				displayName: 'Body Type',
				name: 'bodyType',
				type: 'multiOptions',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
					}
				},
				default: ['fields'],
				options: [
					{
						name: 'Fields',
						value: 'fields',
					},
					{
						name: 'JSON Body',
						value: 'bodyJson',
					},
					{
						name: 'Binary Data',
						value: 'binaryData',
					}
				]
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'assignmentCollection',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
						bodyType: ['fields'],
					},
				},
				typeOptions: {
					loadOptionsDependsOn: ['resource'],
					loadOptionsMethod: 'getFields',
				},
				default: [],
			},
			{
				displayName: 'JSON Body',
				name: 'bodyJson',
				type: 'json',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
						bodyType: ['bodyJson'],
					},
				},
				default: '',
				placeholder: 'Body according to the collection\'s schema',
			},
			{
				displayName: 'Binary Property Name',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
						bodyType: ['binaryData'],
					},
				},
				description: 'Name of the binary property which contains the data to be sent',
			},
			{
				displayName: 'Binary Field Name',
				name: 'binaryFieldName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['create', 'update'],
						bodyType: ['binaryData'],
					},
				},
				description: 'Name of the binary field according to the collection\'s schema. If left empty, the binary data will be sent as a file attachment.',
			}
		],
	};

	methods = {
		loadOptions: LoadOptions,
	};
}

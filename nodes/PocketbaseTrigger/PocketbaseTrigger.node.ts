import {
	ITriggerFunctions,
	ITriggerResponse,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { EventSource } from 'eventsource';
import { LoadOptions } from '../Common/LoadOptions';

export class PocketbaseTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Pocketbase Trigger',
		name: 'pocketbaseTrigger',
		icon: { light: 'file:pocketbaseTrigger.svg', dark: 'file:pocketbaseTrigger.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Handle Pocketbase events via SSE',
		defaults: {
			name: 'Pocketbase Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pocketbaseHttpApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Collection Name',
				name: 'collection',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getCollections',
				},
				default: '',
				required: true,
				description: 'The name of the collection to watch for changes',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: 'Create',
						value: 'create',
					},
					{
						name: 'Update',
						value: 'update',
					},
					{
						name: 'Delete',
						value: 'delete',
					},
				],
				default: ['create', 'update', 'delete'],
				required: true,
				description: 'The events to trigger the node',
			},
		],
	};

	methods = {
		loadOptions: LoadOptions,
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = await this.getCredentials('pocketbaseHttpApi');
		const baseUrl = (credentials.url as string).replace(/\/$/, '');
		const collection = this.getNodeParameter('collection') as string;
		const events = this.getNodeParameter('events') as string[];

		const es = new EventSource(`${baseUrl}/api/realtime`);

		es.addEventListener('PB_CONNECT', async (e: any) => {
			try {
				const data = JSON.parse(e.data as string);
				const clientId = data.clientId;

				await this.helpers.requestWithAuthentication.call(this, 'pocketbaseHttpApi', {
					method: 'POST',
					url: `${baseUrl}/api/realtime`,
					body: {
						clientId,
						subscriptions: [collection],
					},
				});
			} catch (error) {
				es.close();
			}
		});

		es.addEventListener(collection, (e: any) => {
			try {
				const data = JSON.parse(e.data as string);
				if (events.includes(data.action)) {
					this.emit([this.helpers.returnJsonArray(data.record)]);
				}
			} catch (error) {
				// Ignore parse errors or other issues with specific messages
			}
		});

		return {
			closeFunction: async () => {
				es.close();
			},
		};
	}
}

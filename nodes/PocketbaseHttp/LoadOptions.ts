import { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

export interface PocketBaseField {
	autogeneratePattern?: string;
	hidden: boolean;
	id: string;
	max?: number | string;
	min?: number | string;
	name: string;
	pattern?: string;
	presentable: boolean;
	primaryKey?: boolean;
	required?: boolean;
	system: boolean;
	type: string;
	maxSelect?: number;
	values?: string[];
	onCreate?: boolean;
	onUpdate?: boolean;
	cascadeDelete?: boolean;
	collectionId?: string;
	minSelect?: number;
}

async function loadPocketBaseFields(
	this: ILoadOptionsFunctions,
	collectionName: string | null = null,
): Promise<PocketBaseField[]> {
	const { url } = await this.getCredentials('pocketbaseHttpApi');
	const resource = collectionName
		? collectionName
		: (this.getNodeParameter('resource') as unknown as string);
	const { fields } = await this.helpers.httpRequestWithAuthentication.call(this, 'pocketbaseHttpApi', {
		url: `${url}/api/collections/${resource}`,
		method: 'GET',
	});

	return fields as PocketBaseField[];
}

export const LoadOptions = {
	async getCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const returnData: INodePropertyOptions[] = [];
		const { url } = await this.getCredentials('pocketbaseHttpApi');
		const { items } = await this.helpers.httpRequestWithAuthentication.call(this, 'pocketbaseHttpApi', {
			url: `${url}/api/collections`,
			method: 'GET',
		});

		items?.forEach(({ name }: { name: string }) => {
			returnData.push({
				name,
				value: name,
			});
		});

		return returnData;
	},
	async getFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const returnData: INodePropertyOptions[] = [];
		const fields = await loadPocketBaseFields.call(this);

		fields?.forEach(({ name, type }) => {
			if (type === 'relation') {
				returnData.push({
					name: `All fields from relation '${name}'`,
					value: `expand.${name}.*`
				});

				return;
			}

			returnData.push({
				name,
				value: name,
			});
		});

		return returnData;
	},
	async getRelations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const returnData: INodePropertyOptions[] = [];
		const fields = await loadPocketBaseFields.call(this);

		fields?.forEach(({ name, type }) => {
			if (type !== 'relation') {
				return;
			}
			returnData.push({
				name,
				value: name,
			});
		});

		return returnData;
	},
	async getRows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const returnData: INodePropertyOptions[] = [];
		const { url } = await this.getCredentials('pocketbaseHttpApi');
		const resource = this.getNodeParameter('resource') as unknown as string;
		const { items } = await this.helpers.httpRequestWithAuthentication.call(this, 'pocketbaseHttpApi', {
			url: `${url}/api/collections/${resource}/records?sort=-created`,
			method: 'GET',
		});

		items?.forEach(({ id, ...data }: { id: string }) => {
			const name = Object.entries(data).filter(([key]) => {
				return key === 'name';
			})?.[0]?.[1] as string | undefined;
			const shortColumns = Object.fromEntries(
				Object.entries(data).filter(([, column]) => {
					const serialized = JSON.stringify(column);
					return serialized.length <= 20 && serialized.length > 2;
				}),
			);

			returnData.push({
				name: name ? name : JSON.stringify(shortColumns).substring(1, 100),
				value: id,
			});
		});

		return returnData;
	},
};

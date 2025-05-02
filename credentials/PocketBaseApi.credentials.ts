import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PocketBaseApi implements ICredentialType {
	name = 'pocketBaseApi';
	displayName = 'PocketBase API';
	documentationUrl = 'https://pocketbase.io/docs/authentication/';
	properties: INodeProperties[] = [
		{
			displayName: 'URL',
			name: 'url',
			type: 'string',
			default: '',
			required: true
		},
		{
			displayName: 'User collection name',
			description: 'The name of the collection that contains the user (use _superusers if you want to sign in with an administrator account)',
			name: 'userCollection',
			type: 'string',
			default: '_superusers',
			required: true
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true
		}
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials?.url}}',
			url: '=/api/collections/{{$credentials?.userCollection}}/auth-with-password',
			method: 'POST',
			body: {
				identity: '={{$credentials?.username}}',
				password: '={{$credentials?.password}}',
			}
		}
	};
}

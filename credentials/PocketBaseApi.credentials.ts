import {
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
			name: 'userCollection',
			type: 'string',
			default: 'users',
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
}

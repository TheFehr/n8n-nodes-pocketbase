import { describe, it, expect } from 'vitest';
import { PocketbaseTrigger } from '../nodes/PocketbaseTrigger/PocketbaseTrigger.node';
import type { ITriggerFunctions } from 'n8n-workflow';

describe('PocketbaseTrigger Integration', () => {
	const baseUrl = process.env.POCKETBASE_TEST_URL || 'http://localhost:8090';
	const email = process.env.POCKETBASE_TEST_USER || 'test@example.com';
	const password = process.env.POCKETBASE_TEST_PASS || 'password123';

	it('should trigger when a record is created in PocketBase', async () => {
		// 1. Get Admin Token using built-in fetch
		const authRes = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identity: email, password }),
		});
		const authData = await authRes.json() as { token: string };
		const token = authData.token;

		// 2. Setup Trigger Node
		const node = new PocketbaseTrigger();
		let triggeredData: any = null;

		const triggerFunctions: any = {
			getCredentials: async () => ({ url: baseUrl, token }),
			getNodeParameter: (name: string) => {
				if (name === 'collection') return 'users';
				if (name === 'events') return ['create'];
				return undefined;
			},
			helpers: {
				requestWithAuthentication: async (cred: string, options: any) => {
					const res = await fetch(options.url, {
						method: options.method,
						headers: {
							...options.headers,
							'Content-Type': 'application/json',
							Authorization: token,
						},
						body: JSON.stringify(options.body),
					});
					if (res.status === 204) return {};
					return res.json();
				},
				returnJsonArray: (data: any) => [{ json: data }],
			},
			emit: (data: any) => {
				triggeredData = data;
			},
		};

		const { closeFunction } = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

		try {
			// Give it a moment to connect and handshake
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// 3. Create a record to trigger the SSE
			const uniqueEmail = `test-trigger-${Date.now()}@example.com`;
			const createRes = await fetch(`${baseUrl}/api/collections/users/records`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: token,
				},
				body: JSON.stringify({
					username: `user${Date.now()}`,
					email: uniqueEmail,
					password: 'password123',
					passwordConfirm: 'password123',
					name: 'Trigger Test User',
				}),
			});

			if (!createRes.ok) {
				const error = await createRes.text();
				throw new Error(`Failed to create record: ${error}`);
			}

			// 4. Wait for the trigger to catch the event
			for (let i = 0; i < 40; i++) {
				if (triggeredData) break;
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			expect(triggeredData).toBeDefined();
			expect(triggeredData[0][0].json.email).toBe(uniqueEmail);
		} finally {
			if (closeFunction) await closeFunction();
		}
	}, 30000); // 30s timeout
});

import { describe, it, expect } from "vitest";
import { PocketbaseTrigger } from "../nodes/PocketbaseTrigger/PocketbaseTrigger.node";
import type { ITriggerFunctions } from "n8n-workflow";

const runIntegration = process.env.RUN_POCKETBASE_INTEGRATION === "true";

describe.skipIf(!runIntegration)("PocketbaseTrigger Integration", () => {
  const baseUrl = process.env.POCKETBASE_TEST_URL || "http://localhost:8090";
  const email = process.env.POCKETBASE_TEST_USER || "test@example.com";
  const password = process.env.POCKETBASE_TEST_PASS || "password123";

  it("should trigger when a record is created in PocketBase", async () => {
    // 1. Get Admin Token using built-in fetch
    const authRes = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });

    if (!authRes.ok) {
      throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);
    }

    const authData = (await authRes.json()) as { token: string };
    const token = authData.token;

    if (!token) {
      throw new Error(`No token returned for user ${email}`);
    }

    // 2. Setup Trigger Node
    const node = new PocketbaseTrigger();
    // Other integration tests create users while this one runs, so collect every event.
    const received: unknown[][] = [];
    // Counts accepted realtime subscriptions, so the test waits for one instead of a fixed delay.
    let subscriptions = 0;
    const findTriggered = (wanted: string) =>
      received.find(
        (data) => (data[0] as { json: { email: string } }[])[0].json.email === wanted,
      );

    interface MockHttpRequestOptions {
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    }

    const triggerFunctions = {
      getCredentials: async () => ({ url: baseUrl, username: email, password }),
      getNodeParameter: (name: string) => {
        if (name === "collection") return "users";
        if (name === "events") return ["create"];
        return undefined;
      },
      helpers: {
        // Plain httpRequest: unlike the real credential-authenticated helper of the past, this adds no
        // Authorization header, so the trigger has to authenticate its own realtime subscription.
        httpRequest: async (options: MockHttpRequestOptions) => {
          const res = await fetch(options.url, {
            method: options.method,
            headers: {
              ...options.headers,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(options.body),
          });

          if (res.ok && options.url.endsWith("/api/realtime")) subscriptions++;
          if (res.status === 204) return {};

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Request failed: ${res.status} ${text}`);
          }

          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            return res.json();
          }
          return { body: await res.text() };
        },
        returnJsonArray: (data: unknown) => [{ json: data }],
      },
      emit: (data: unknown[]) => {
        received.push(data);
      },
      logger: {
        error: console.error,
        info: console.log,
        debug: console.debug,
        warn: console.warn,
      },
      emitError: (err: unknown) => {
        console.error("Trigger emitted error:", err);
      },
    };

    const { closeFunction } = await node.trigger.call(
      triggerFunctions as unknown as ITriggerFunctions,
    );

    let createdRecordId: string | undefined;

    try {
      // Events from before PocketBase accepts the subscription are lost, so wait for it.
      for (let i = 0; i < 60 && subscriptions === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(subscriptions, "PocketBase did not accept the subscription within 30s").toBe(1);

      // 3. Create a record to trigger the SSE
      const uniqueEmail = `test-trigger-${Date.now()}@example.com`;
      const createRes = await fetch(`${baseUrl}/api/collections/users/records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        body: JSON.stringify({
          username: `user${Date.now()}`,
          email: uniqueEmail,
          password: "password123",
          passwordConfirm: "password123",
          name: "Trigger Test User",
        }),
      });

      if (!createRes.ok) {
        const error = await createRes.text();
        throw new Error(`Failed to create record: ${error}`);
      }

      const createData = (await createRes.json()) as { id: string };
      createdRecordId = createData.id;

      // 4. Wait for the trigger to catch the event
      for (let i = 0; i < 40; i++) {
        if (findTriggered(uniqueEmail)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const triggeredData = findTriggered(uniqueEmail);
      expect(
        triggeredData,
        "Timeout waiting for Pocketbase trigger: no event for the new record after 20s",
      ).toBeDefined();
      expect(triggeredData).toHaveLength(1);
      expect(triggeredData![0]).toHaveLength(1);
      expect((triggeredData![0] as { json: { email: string } }[])[0].json.email).toBe(uniqueEmail);
    } finally {
      if (createdRecordId) {
        const deleteRes = await fetch(
          `${baseUrl}/api/collections/users/records/${createdRecordId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: token,
            },
          },
        );
        if (!deleteRes.ok) {
          console.warn(`Failed to cleanup test record ${createdRecordId}: ${deleteRes.status}`);
        }
      }
      if (closeFunction) await closeFunction();
    }
  }, 30000); // 30s timeout
});

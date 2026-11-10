import { describe, it, expect } from "vitest";
import { PocketbaseTrigger } from "../nodes/PocketbaseTrigger/PocketbaseTrigger.node";
import type { ITriggerFunctions } from "n8n-workflow";

const runIntegration = process.env.RUN_POCKETBASE_INTEGRATION === "true";

async function waitFor(condition: () => boolean, what: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// PocketBase filters and shapes realtime events on the server when the topic carries options.
describe.skipIf(!runIntegration)("PocketbaseTrigger options (integration)", () => {
  const url = (process.env.POCKETBASE_TEST_URL || "http://localhost:8090").replace(/\/$/, "");
  const email = process.env.POCKETBASE_TEST_USER || "test@example.com";
  const password = process.env.POCKETBASE_TEST_PASS || "password123";

  it("should deliver only matching records, shaped by fields", async () => {
    const authRes = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });
    if (!authRes.ok) throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);
    const { token } = (await authRes.json()) as { token: string };

    const marker = `match${Date.now()}`;
    const createUser = async (name: string) => {
      const res = await fetch(`${url}/api/collections/users/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({
          username: `u${name}${Date.now()}`,
          email: `opt-${name}-${Date.now()}@example.com`,
          password: "password123",
          passwordConfirm: "password123",
          name,
        }),
      });
      if (!res.ok) throw new Error(`Failed to create record: ${await res.text()}`);
      return ((await res.json()) as { id: string }).id;
    };

    // Counts accepted realtime subscriptions, so tests wait for those instead of a fixed delay.
    let subscriptions = 0;
    const emitted: Record<string, unknown>[] = [];
    const emittedErrors: unknown[] = [];
    const triggerFunctions = {
      getCredentials: async () => ({ url, username: email, password }),
      getNodeParameter: (name: string) => {
        if (name === "collection") return "users";
        if (name === "events") return ["create"];
        if (name === "options") return { filter: `name = "${marker}"`, fields: "id,name" };
        return undefined;
      },
      helpers: {
        httpRequest: async (options: {
          url: string;
          method: string;
          headers?: Record<string, string>;
          body?: unknown;
        }) => {
          const res = await fetch(options.url, {
            method: options.method,
            headers: { ...options.headers, "Content-Type": "application/json" },
            body: JSON.stringify(options.body),
          });
          if (res.ok && options.url.endsWith("/api/realtime")) subscriptions++;
          if (res.status === 204) return {};
          if (!res.ok) throw new Error(`Request failed: ${res.status} ${await res.text()}`);
          return res.json();
        },
        returnJsonArray: (data: unknown) => [{ json: data }],
      },
      emit: (data: unknown[]) => {
        emitted.push((data as { json: Record<string, unknown> }[][])[0][0].json);
      },
      emitError: (error: unknown) => {
        emittedErrors.push(error);
      },
      logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    };

    const { closeFunction } = await new PocketbaseTrigger().trigger.call(
      triggerFunctions as unknown as ITriggerFunctions,
    );

    const createdIds: string[] = [];
    try {
      await waitFor(() => subscriptions === 1, "PocketBase to accept the subscription");
      createdIds.push(await createUser("nomatch"));
      const matchId = await createUser(marker);
      createdIds.push(matchId);

      await waitFor(() => emitted.length > 0, "the matching record");
      // Give a wrongly delivered non-matching event time to arrive before asserting.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(emitted).toEqual([{ id: matchId, name: marker, __action: "create" }]);
      expect(emittedErrors).toEqual([]);
    } finally {
      await closeFunction?.();
      for (const id of createdIds) {
        await fetch(`${url}/api/collections/users/records/${id}`, {
          method: "DELETE",
          headers: { Authorization: token },
        });
      }
    }
  }, 60000);
});

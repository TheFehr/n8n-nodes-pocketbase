import { describe, it, expect } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { PocketbaseTrigger } from "../nodes/PocketbaseTrigger/PocketbaseTrigger.node";
import type { ITriggerFunctions } from "n8n-workflow";

const runIntegration = process.env.RUN_POCKETBASE_INTEGRATION === "true";

async function waitFor(condition: () => boolean, what: string, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// PocketBase closes a realtime connection after five idle minutes. A TCP proxy in front of it
// cuts the stream on demand, so the same drop can be tested in seconds against the real server.
describe.skipIf(!runIntegration)("PocketbaseTrigger reconnect (integration)", () => {
  const upstream = new URL(process.env.POCKETBASE_TEST_URL || "http://localhost:8090");
  const email = process.env.POCKETBASE_TEST_USER || "test@example.com";
  const password = process.env.POCKETBASE_TEST_PASS || "password123";

  it("should keep delivering events after the stream is cut, without emitting an error", async () => {
    const streams: net.Socket[] = [];
    const proxy = net.createServer((client) => {
      const target = net.connect(Number(upstream.port), upstream.hostname);
      let registered = false;
      client.on("data", (chunk) => {
        // A keep-alive socket can carry a subscription POST before the realtime GET, so every chunk is
        // checked, not just the first. Only the realtime stream is cut; the node's own HTTP requests
        // use their own sockets.
        if (!registered && chunk.toString("latin1").startsWith("GET /api/realtime")) {
          registered = true;
          streams.push(client);
        }
        target.write(chunk);
      });
      target.on("data", (chunk) => client.write(chunk));
      client.on("close", () => target.destroy());
      target.on("close", () => client.destroy());
      client.on("error", () => target.destroy());
      target.on("error", () => client.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    const authRes = await fetch(`${upstream.origin}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });
    if (!authRes.ok) throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);
    const { token } = (await authRes.json()) as { token: string };

    const createUser = async (label: string) => {
      const uniqueEmail = `test-reconnect-${label}-${Date.now()}@example.com`;
      const res = await fetch(`${upstream.origin}/api/collections/users/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({
          username: `user${label}${Date.now()}`,
          email: uniqueEmail,
          password: "password123",
          passwordConfirm: "password123",
          name: "Reconnect Test User",
        }),
      });
      if (!res.ok) throw new Error(`Failed to create record: ${await res.text()}`);
      const { id } = (await res.json()) as { id: string };
      return { id, email: uniqueEmail };
    };

    const emittedEmails: string[] = [];
    const emittedErrors: unknown[] = [];
    const triggerFunctions = {
      getCredentials: async () => ({ url: proxyUrl, username: email, password }),
      getNodeParameter: (name: string) => {
        if (name === "collection") return "users";
        if (name === "events") return ["create"];
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
          if (res.status === 204) return {};
          if (!res.ok) throw new Error(`Request failed: ${res.status} ${await res.text()}`);
          return res.json();
        },
        returnJsonArray: (data: unknown) => [{ json: data }],
      },
      emit: (data: unknown[]) => {
        emittedEmails.push((data as { json: { email: string } }[][])[0][0].json.email);
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
      await waitFor(() => streams.length === 1, "the realtime stream to open");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const before = await createUser("before");
      createdIds.push(before.id);
      await waitFor(() => emittedEmails.includes(before.email), "the event before the drop", 20000);

      // What PocketBase does after five idle minutes.
      streams[0].destroy();

      await waitFor(() => streams.length === 2, "the trigger to reconnect");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const after = await createUser("after");
      createdIds.push(after.id);
      await waitFor(() => emittedEmails.includes(after.email), "the event after the drop", 20000);

      expect(emittedErrors).toEqual([]);
    } finally {
      await closeFunction?.();
      proxy.close();
      for (const id of createdIds) {
        await fetch(`${upstream.origin}/api/collections/users/records/${id}`, {
          method: "DELETE",
          headers: { Authorization: token },
        });
      }
    }
  }, 90000);
});

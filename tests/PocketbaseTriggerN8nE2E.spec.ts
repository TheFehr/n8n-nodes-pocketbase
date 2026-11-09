import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";

const runE2E = process.env.RUN_N8N_E2E === "true";

// The rule guards node code that runs inside n8n; this test drives the Docker test stack from outside it.
const compose = (...args: string[]) =>
  // eslint-disable-next-line @n8n/community-nodes/no-dangerous-functions -- test-only, fixed command with no user input
  execFileSync("docker", ["compose", "-f", "docker-compose.test.yml", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => Promise<boolean> | boolean, what: string, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}

// A workflow with the Trigger node is published in a real n8n, which writes one file per event it
// receives. PocketBase is then driven through its API and the files are what the test reads, so
// this covers what the node does inside n8n: activation, delivery and surviving a dropped stream.
describe.skipIf(!runE2E)("PocketbaseTrigger in a real n8n (e2e)", () => {
  const pbUrl = process.env.POCKETBASE_TEST_URL || "http://localhost:8090";
  const n8nUrl = process.env.N8N_TEST_URL || "http://localhost:5678";
  const email = process.env.POCKETBASE_TEST_USER || "test@example.com";
  const password = process.env.POCKETBASE_TEST_PASS || "password123";
  const created: string[] = [];

  let token = "";
  const login = async () => {
    const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
    token = ((await res.json()) as { token: string }).token;
  };
  const pb = (path: string, method: string, body?: unknown) =>
    fetch(`${pbUrl}/api/collections/users/records${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: token },
      body: body ? JSON.stringify(body) : undefined,
    });
  const createUser = async (label: string) => {
    const res = await pb("", "POST", {
      username: `e2e${label}${Date.now()}`,
      email: `e2e-${label}-${Date.now()}@example.com`,
      password: "password123",
      passwordConfirm: "password123",
    });
    if (!res.ok) throw new Error(`Failed to create record: ${await res.text()}`);
    const id = ((await res.json()) as { id: string }).id;
    created.push(id);
    return id;
  };

  // One JSON document per file written by the workflow inside the n8n container.
  const readEvents = () =>
    compose(
      "exec",
      "-T",
      "n8n",
      "sh",
      "-c",
      'for f in /home/node/.n8n-files/trigger-e2e-*; do [ -f "$f" ] && cat "$f" && echo; done; true',
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string; name?: string; __action: string });
  const eventsFor = (id: string) => readEvents().filter((event) => event.id === id);

  // The options workflow writes to its own files, so its events can't be mistaken for the other's.
  const readOptionsEvents = () =>
    compose(
      "exec",
      "-T",
      "n8n",
      "sh",
      "-c",
      'for f in /home/node/.n8n-files/options-e2e-*; do [ -f "$f" ] && cat "$f" && echo; done; true',
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  const superuser = (path: string, method: string, body?: unknown) =>
    fetch(`${pbUrl}/api/collections${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: token },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    await login();
    // A collection with a relation, for the options that filter, shape and expand records.
    const collection = await superuser("", "POST", {
      name: "e2e_posts",
      type: "base",
      fields: [
        { name: "title", type: "text" },
        { name: "note", type: "text" },
        { name: "author", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      ],
    });
    if (!collection.ok) throw new Error(`Failed to create collection: ${await collection.text()}`);
    compose("stop", "n8n");
    compose(
      "run",
      "--rm",
      "--entrypoint",
      "/bin/sh",
      "n8n",
      "-c",
      [
        "mkdir -p /home/node/.n8n/nodes/node_modules",
        "ln -sf /home/node/custom-nodes /home/node/.n8n/nodes/node_modules/n8n-nodes-pocketbase",
        "n8n import:credentials --input=/home/node/custom-nodes/tests/workflows/integration_credentials.json",
        "n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_trigger_e2e.json",
        "n8n import:workflow --input=/home/node/custom-nodes/tests/workflows/integration_trigger_options_e2e.json",
        "n8n publish:workflow --id=trigger-e2e",
        "n8n publish:workflow --id=trigger-e2e-options",
      ].join(" && "),
    );
    compose("up", "-d", "--force-recreate", "n8n");
    await waitFor(async () => (await fetch(`${n8nUrl}/healthz`).catch(() => null))?.ok === true, "n8n to start");
    // Events from before the subscription exists are lost, so probe until the first one arrives.
    await waitFor(
      async () => {
        const id = await createUser("warmup");
        await sleep(1500);
        return eventsFor(id).length > 0;
      },
      "the published workflow to receive its first event",
      90000,
    );
  }, 240000);

  afterAll(async () => {
    await login().catch(() => {});
    for (const id of created) await pb(`/${id}`, "DELETE").catch(() => {});
    await superuser("/e2e_posts", "DELETE").catch(() => {});
    compose("stop", "n8n");
  });

  it("should start the workflow for creates, updates and deletes made through the API", async () => {
    const id = await createUser("crud");
    await waitFor(() => eventsFor(id).some((e) => e.__action === "create"), "the create event");

    expect((await pb(`/${id}`, "PATCH", { name: "Renamed" })).ok).toBe(true);
    await waitFor(() => eventsFor(id).some((e) => e.__action === "update"), "the update event");

    expect((await pb(`/${id}`, "DELETE")).ok).toBe(true);
    await waitFor(() => eventsFor(id).some((e) => e.__action === "delete"), "the delete event");

    const events = eventsFor(id);
    expect(events.map((e) => e.__action).sort()).toEqual(["create", "delete", "update"]);
    expect(events.find((e) => e.__action === "update")?.name).toBe("Renamed");
  }, 60000);

  it("should start the options workflow only for matching records, shaped and expanded", async () => {
    const authorId = await createUser("author");
    const post = async (title: string) => {
      const res = await superuser("/e2e_posts/records", "POST", {
        title,
        note: "not requested",
        author: authorId,
      });
      if (!res.ok) throw new Error(`Failed to create post: ${await res.text()}`);
      return ((await res.json()) as { id: string }).id;
    };

    // The workflow may not be subscribed yet, so the matching post is retried until it shows up.
    await post("nomatch");
    let matchId = "";
    await waitFor(
      async () => {
        matchId = await post("match");
        await sleep(1500);
        return readOptionsEvents().some((event) => event.id === matchId);
      },
      "the event for the matching post",
      60000,
    );
    // Give a wrongly delivered non-matching event time to arrive before asserting.
    await sleep(1500);

    const events = readOptionsEvents();
    expect(events.every((event) => event.title === "match")).toBe(true);
    const event = events.find((e) => e.id === matchId)!;
    // `fields` leaves out everything not requested, and `expand` brings in the related user.
    expect(event).not.toHaveProperty("note");
    expect(event).not.toHaveProperty("created");
    expect((event.expand as { author: { id: string } }).author.id).toBe(authorId);
  }, 90000);

  it("should keep the workflow active and delivering after PocketBase drops the stream", async () => {
    // Restarting PocketBase closes every open realtime connection, like its idle timeout does.
    compose("restart", "pocketbase");
    await waitFor(async () => (await fetch(`${pbUrl}/api/health`).catch(() => null))?.ok === true, "PocketBase to restart");
    await login();

    // The node reconnects with a backoff; keep creating records until one is delivered.
    let delivered: string | undefined;
    await waitFor(
      async () => {
        const id = await createUser("afterdrop");
        await sleep(2000);
        if (eventsFor(id).length > 0) delivered = id;
        return delivered !== undefined;
      },
      "an event after PocketBase restarted",
      90000,
    );
    expect(eventsFor(delivered!).map((e) => e.__action)).toContain("create");

    const logs = compose("logs", "n8n");
    expect(logs).not.toMatch(/deactivat/i);
  }, 150000);
});

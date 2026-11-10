import { describe, it, expect, vi, beforeEach } from "vitest";
import { PocketbaseTrigger } from "../nodes/PocketbaseTrigger/PocketbaseTrigger.node";
import type { ITriggerFunctions } from "n8n-workflow";
import { EventSource } from "eventsource";

vi.mock("eventsource", () => {
  return {
    EventSource: vi.fn(),
  };
});

interface MockTriggerFunctions {
  getCredentials: ReturnType<typeof vi.fn>;
  getNodeParameter: ReturnType<typeof vi.fn>;
  helpers: {
    httpRequest: ReturnType<typeof vi.fn>;
    returnJsonArray: ReturnType<typeof vi.fn>;
  };
  emit: ReturnType<typeof vi.fn>;
  emitError: ReturnType<typeof vi.fn>;
  logger: {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

interface MockEventSourceInstance {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

describe("PocketbaseTrigger", () => {
  let triggerFunctions: MockTriggerFunctions;
  let node: PocketbaseTrigger;
  let esInstance: MockEventSourceInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    node = new PocketbaseTrigger();
    triggerFunctions = {
      getCredentials: vi.fn().mockResolvedValue({
        url: "http://localhost:8090",
        username: "admin@example.com",
        password: "secret",
      }),
      getNodeParameter: vi.fn(),
      helpers: {
        httpRequest: vi.fn(async (options: { url: string }) =>
          options.url.endsWith("/auth-with-password") ? { token: "test-token" } : {},
        ),
        returnJsonArray: vi.fn((data: unknown) => [{ json: data }]),
      },
      emit: vi.fn(),
      emitError: vi.fn(),
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
      },
    };
    esInstance = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    // Use a regular function to support 'new'
    vi.mocked(EventSource).mockImplementation(function (this: unknown) {
      return esInstance;
    } as unknown as (url: string | URL) => EventSource);
  });

  it("should perform handshake on PB_CONNECT", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create", "update", "delete"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    expect(EventSource).toHaveBeenCalledWith("http://localhost:8090/api/realtime");
    expect(esInstance.addEventListener).toHaveBeenCalledWith("PB_CONNECT", expect.any(Function));

    // Simulate PB_CONNECT
    const pbConnectCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "PB_CONNECT",
    )![1];
    await pbConnectCallback({ data: JSON.stringify({ clientId: "mock-client-id" }) });

    // The credential has no `authenticate` property, so the subscription must carry its own token.
    // Without it PocketBase treats the client as a guest and never delivers events for locked collections.
    expect(triggerFunctions.helpers.httpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "http://localhost:8090/api/collections/_superusers/auth-with-password",
      body: { identity: "admin@example.com", password: "secret" },
    });
    expect(triggerFunctions.helpers.httpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "http://localhost:8090/api/realtime",
      headers: { Authorization: "test-token" },
      body: {
        clientId: "mock-client-id",
        subscriptions: ["posts"],
      },
    });
  });

  it("should emit data on matching event", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "posts",
    )![1];

    // Event that matches
    await collectionCallback({
      data: JSON.stringify({
        action: "create",
        record: { id: "1", title: "Hello" },
      }),
    });

    expect(triggerFunctions.emit).toHaveBeenCalledWith([
      [{ json: { __action: "create", id: "1", title: "Hello" } }],
    ]);
  });

  it("should handle record action collisions in onMessage", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "posts",
    )![1];

    // Event with record already having an 'action' field
    await collectionCallback({
      data: JSON.stringify({
        action: "create",
        record: { id: "1", action: "original-action-value" },
      }),
    });

    expect(triggerFunctions.emit).toHaveBeenCalledWith([
      [
        {
          json: {
            id: "1",
            action: "original-action-value",
            __original_action: "original-action-value",
            __action: "create",
          },
        },
      ],
    ]);
  });

  it("should leave a test run waiting for a real event instead of emitting sample data", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create", "update", "delete"];
      return undefined;
    });

    const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    // n8n runs manualTriggerFunction as soon as a test run starts and never waits for the real
    // subscription; without one it waits for the first emit() of the live stream.
    expect(response.manualTriggerFunction).toBeUndefined();
    expect(triggerFunctions.emit).not.toHaveBeenCalled();
  });

  it("should subscribe to a topic carrying the filter, fields and expand options", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      if (name === "options") {
        return { filter: "status = 'paid'", fields: "id,status", expand: "customer" };
      }
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const topic = `posts?options=${encodeURIComponent(
      JSON.stringify({
        query: { filter: "status = 'paid'", fields: "id,status", expand: "customer" },
      }),
    )}`;
    // The event is named after the exact subscribed topic, so the listener has to use it too.
    const topicCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === topic,
    )?.[1];
    expect(topicCallback).toBeDefined();
    expect(esInstance.addEventListener).not.toHaveBeenCalledWith("posts", expect.any(Function));

    const connect = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "PB_CONNECT",
    )![1];
    await connect({ data: JSON.stringify({ clientId: "c1" }) });
    expect(triggerFunctions.helpers.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:8090/api/realtime",
        body: { clientId: "c1", subscriptions: [topic] },
      }),
    );

    topicCallback({ data: JSON.stringify({ action: "create", record: { id: "1" } }) });
    expect(triggerFunctions.emit).toHaveBeenCalledTimes(1);
  });

  it("should leave out empty options and subscribe to the plain collection", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      if (name === "options") return { filter: "", fields: "" };
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    expect(esInstance.addEventListener).toHaveBeenCalledWith("posts", expect.any(Function));
  });

  it("should not emit data on non-matching event", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "posts",
    )![1];

    // Event that does NOT match ('update' instead of 'create')
    await collectionCallback({
      data: JSON.stringify({
        action: "update",
        record: { id: "1", title: "Hello" },
      }),
    });

    expect(triggerFunctions.emit).not.toHaveBeenCalled();
  });

  it("should close EventSource on closeFunction", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    await response.closeFunction!();

    expect(esInstance.close).toHaveBeenCalled();
  });

  // PocketBase closes a realtime connection after five idle minutes. That is routine, and emitError
  // would make n8n deactivate the workflow, so a drop must be handled by reconnecting alone.
  it.each([
    ["an Error", new Error("Connection failed")],
    ["a plain event object", { message: "Conn failed", code: 500 }],
  ])(
    "should reconnect without emitting an error when the stream drops with %s",
    async (_label, dropped) => {
      vi.useFakeTimers();
      try {
        triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
          if (name === "collection") return "posts";
          if (name === "events") return ["create"];
          return undefined;
        });

        const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);
        expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(1);

        const errorCallback = esInstance.addEventListener.mock.calls.find(
          (call: unknown[]) => call[0] === "error",
        )![1];
        errorCallback(dropped);

        expect(triggerFunctions.logger.warn).toHaveBeenCalledWith(
          "PocketBase SSE connection lost, reconnecting",
          expect.objectContaining({ error: dropped, baseUrl: "http://localhost:8090" }),
        );
        expect(esInstance.close).toHaveBeenCalled();
        expect(triggerFunctions.emitError).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(31_000);
        expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(2);
        expect(triggerFunctions.emitError).not.toHaveBeenCalled();

        await response.closeFunction!();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // A server that is still starting after a restart refuses or fails requests; that must not
  // deactivate the workflow. Rejected credentials fail the same way every time and are reported.
  it.each([
    [
      "a refused connection",
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    ],
    ["a 503 from n8n's request helper", { httpCode: "503", message: "Service unavailable" }],
    ["a 502 on the response", { response: { status: 502 }, message: "Bad gateway" }],
    ["a 404 for a client id that is already gone", { httpCode: "404", message: "Not found" }],
  ])("should retry quietly when connecting fails with %s", async (_label, failure) => {
    vi.useFakeTimers();
    try {
      triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
        if (name === "collection") return "posts";
        if (name === "events") return ["create"];
        return undefined;
      });
      triggerFunctions.helpers.httpRequest.mockRejectedValue(failure);

      const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);
      const connect = esInstance.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "PB_CONNECT",
      )![1];
      await connect({ data: JSON.stringify({ clientId: "c1" }) });

      expect(triggerFunctions.emitError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(2);
      expect(triggerFunctions.emitError).not.toHaveBeenCalled();

      await response.closeFunction!();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["httpCode", { httpCode: "400", message: "Failed to authenticate." }],
    ["status", { status: 401, message: "Unauthorized" }],
    ["response.status", { response: { status: 403 }, message: "Forbidden" }],
  ])("should report rejected credentials at once (%s)", async (_label, failure) => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });
    triggerFunctions.helpers.httpRequest.mockRejectedValue(failure);

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);
    const connect = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "PB_CONNECT",
    )![1];
    await connect({ data: JSON.stringify({ clientId: "c1" }) });

    expect(triggerFunctions.emitError).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403])(
    "should report an SSE stream rejected with HTTP %s at once",
    async (code) => {
      triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
        if (name === "collection") return "posts";
        if (name === "events") return ["create"];
        return undefined;
      });

      await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);
      const errorCallback = esInstance.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )![1];
      errorCallback({ code, message: "rejected" });

      expect(triggerFunctions.emitError).toHaveBeenCalledTimes(1);
    },
  );

  it("should ignore a subscription failure from a stream that has been replaced", async () => {
    vi.useFakeTimers();
    try {
      triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
        if (name === "collection") return "posts";
        if (name === "events") return ["create"];
        return undefined;
      });
      // Each connection gets its own stream object, as the real EventSource does.
      vi.mocked(EventSource).mockImplementation(function (this: unknown) {
        esInstance = { addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn() };
        return esInstance;
      } as unknown as (url: string | URL) => EventSource);
      let rejectSubscription: (reason: unknown) => void = () => {};
      triggerFunctions.helpers.httpRequest.mockImplementation(
        () => new Promise((_resolve, reject) => (rejectSubscription = reject)),
      );

      const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);
      const connect = esInstance.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "PB_CONNECT",
      )![1];
      const errorCallback = esInstance.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )![1];
      const pending = connect({ data: JSON.stringify({ clientId: "c1" }) });
      await vi.advanceTimersByTimeAsync(0);

      errorCallback({ message: "dropped" });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(2);

      rejectSubscription({ httpCode: "404", message: "Not found" });
      await pending;
      await vi.advanceTimersByTimeAsync(0);

      // The old request failing must not close the replacement stream or schedule another one.
      expect(vi.mocked(EventSource)).toHaveBeenCalledTimes(2);
      expect(triggerFunctions.logger.warn).not.toHaveBeenCalledWith(
        "Failed to connect to PocketBase SSE, retrying",
        expect.anything(),
      );

      await response.closeFunction!();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should emit an error only once reconnecting is exhausted", async () => {
    vi.useFakeTimers();
    try {
      triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
        if (name === "collection") return "posts";
        if (name === "events") return ["create"];
        return undefined;
      });

      await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

      const errorCallback = esInstance.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )![1];

      // The server stays unreachable: every attempt fails before the stream is ever stable.
      for (let attempt = 0; attempt < 50; attempt++) {
        errorCallback({ message: "down" });
        await vi.advanceTimersByTimeAsync(31_000);
      }
      expect(triggerFunctions.emitError).not.toHaveBeenCalled();

      errorCallback({ message: "down" });
      expect(triggerFunctions.emitError).toHaveBeenCalledTimes(1);
      expect(triggerFunctions.emitError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Maximum reconnection attempts (50)"),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("should redact sensitive data on parse failure", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "posts",
    )![1];

    // Invalid JSON with sensitive data and emails
    const invalidData =
      '{ "action": "create", "password": "secret", "token": "xyz", "email": "test@example.com", "msg": "Send it to someone@else.com", "invalid": ';
    collectionCallback({ data: invalidData });

    expect(triggerFunctions.logger.error).toHaveBeenCalledWith(
      "Failed to parse PocketBase SSE message",
      expect.objectContaining({
        collection: "posts",
      }),
    );

    const loggedMeta = triggerFunctions.logger.error.mock.calls[0][1];
    expect(loggedMeta.redactedPreview).toContain('"password": "[REDACTED]"');
    expect(loggedMeta.redactedPreview).toContain('"token": "[REDACTED]"');
    expect(loggedMeta.redactedPreview).toContain('"email": "[REDACTED]"');
    expect(loggedMeta.redactedPreview).toContain("Send it to [REDACTED]");
    expect(loggedMeta.redactedPreview.length).toBeLessThanOrEqual(200);
  });
});

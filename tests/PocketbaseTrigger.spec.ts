import { describe, it, expect, vi, beforeEach } from "vitest";
import { PocketbaseTrigger } from "../nodes/PocketbaseTrigger/PocketbaseTrigger.node";
import type { ITriggerFunctions } from "n8n-workflow";
import { EventSource } from "eventsource";

vi.mock("eventsource", () => {
  return {
    EventSource: vi.fn(),
  };
});

describe("PocketbaseTrigger", () => {
  let triggerFunctions: any;
  let node: PocketbaseTrigger;
  let esInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    node = new PocketbaseTrigger();
    triggerFunctions = {
      getCredentials: vi.fn().mockResolvedValue({ url: "http://localhost:8090" }),
      getNodeParameter: vi.fn(),
      helpers: {
        requestWithAuthentication: vi.fn(),
        returnJsonArray: vi.fn((data: any) => [{ json: data }]),
      },
      emit: vi.fn(),
      emitError: vi.fn(),
      logger: {
        error: vi.fn(),
      },
    };
    esInstance = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    // Use a regular function to support 'new'
    vi.mocked(EventSource).mockImplementation(function (this: any) {
      return esInstance;
    } as any);
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
      (call: any) => call[0] === "PB_CONNECT",
    )[1];
    await pbConnectCallback({ data: JSON.stringify({ clientId: "mock-client-id" }) });

    expect(triggerFunctions.helpers.requestWithAuthentication).toHaveBeenCalledWith(
      "pocketbaseHttpApi",
      {
        method: "POST",
        url: "http://localhost:8090/api/realtime",
        body: {
          clientId: "mock-client-id",
          subscriptions: ["posts"],
        },
      },
    );
  });

  it("should emit data on matching event", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: any) => call[0] === "posts",
    )[1];

    // Event that matches
    await collectionCallback({
      data: JSON.stringify({
        action: "create",
        record: { id: "1", title: "Hello" },
      }),
    });

    expect(triggerFunctions.emit).toHaveBeenCalledWith([
      [{ json: { action: "create", record: { id: "1", title: "Hello" } } }],
    ]);
  });

  it("should emit sample data on manualTriggerFunction", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create", "update", "delete"];
      return undefined;
    });

    const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    if (response.manualTriggerFunction) {
      await response.manualTriggerFunction();
      expect(triggerFunctions.emit).toHaveBeenCalledWith([
        [
          {
            json: expect.objectContaining({
              action: "create",
              record: expect.objectContaining({
                collectionName: "posts",
              }),
            }),
          },
        ],
      ]);
    } else {
      throw new Error("manualTriggerFunction should be defined");
    }
  });

  it("should not emit data on non-matching event", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: any) => call[0] === "posts",
    )[1];

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

  it("should handle EventSource connection failure", async () => {
    vi.useFakeTimers();
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    const response = await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const errorCallback = esInstance.addEventListener.mock.calls.find(
      (call: any) => call[0] === "error",
    )[1];

    const mockError = new Error("Connection failed");
    errorCallback(mockError);

    expect(triggerFunctions.logger.error).toHaveBeenCalledWith(
      "PocketBase SSE connection failure",
      expect.objectContaining({ error: mockError, baseUrl: "http://localhost:8090" }),
    );
    expect(triggerFunctions.emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Connection failed",
        originalErrorEvent: mockError,
      }),
    );
    expect(esInstance.close).toHaveBeenCalled();

    await response.closeFunction!();
    vi.useRealTimers();
  });

  it("should redact sensitive data on parse failure", async () => {
    triggerFunctions.getNodeParameter.mockImplementation((name: string) => {
      if (name === "collection") return "posts";
      if (name === "events") return ["create"];
      return undefined;
    });

    await node.trigger.call(triggerFunctions as unknown as ITriggerFunctions);

    const collectionCallback = esInstance.addEventListener.mock.calls.find(
      (call: any) => call[0] === "posts",
    )[1];

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
  });
});

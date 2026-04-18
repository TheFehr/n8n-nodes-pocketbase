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
    };
    esInstance = {
      addEventListener: vi.fn(),
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

    expect(triggerFunctions.emit).toHaveBeenCalledWith([[{ json: { id: "1", title: "Hello" } }]]);
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
});

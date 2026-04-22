import {
  ITriggerFunctions,
  ITriggerResponse,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
} from "n8n-workflow";
import { EventSource } from "eventsource";
import { LoadOptions } from "../Common/LoadOptions";

export class PocketbaseTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Pocketbase (Beta) Trigger",
    name: "pocketbaseTrigger",
    icon: { light: "file:pocketbaseTrigger.svg", dark: "file:pocketbaseTrigger.dark.svg" },
    group: ["trigger"],
    version: 1,
    description: "Handle Pocketbase events via SSE (Beta)",
    defaults: {
      name: "Pocketbase Trigger",
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "pocketbaseHttpApi",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Collection Name",
        name: "collection",
        type: "options",
        typeOptions: {
          loadOptionsMethod: "getCollections",
        },
        default: "",
        required: true,
        description: "The name of the collection to watch for changes",
      },
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        options: [
          {
            name: "Create",
            value: "create",
          },
          {
            name: "Update",
            value: "update",
          },
          {
            name: "Delete",
            value: "delete",
          },
        ],
        default: ["create", "update", "delete"],
        required: true,
        description: "The events to trigger the node",
      },
    ],
  };

  methods = {
    loadOptions: LoadOptions,
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const credentials = await this.getCredentials("pocketbaseHttpApi");
    const baseUrl = (credentials.url as string).replace(/\/$/, "");
    const collection = this.getNodeParameter("collection") as string;
    const events = this.getNodeParameter("events") as string[];

    const { closeFunction } = subscribeToPocketbaseSSE.call(this, baseUrl, collection, events);

    return {
      closeFunction,
      manualTriggerFunction: async () => {
        const sampleData = {
          action: "create",
          record: {
            id: "sample-id",
            collectionId: "sample-collection-id",
            collectionName: collection,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
          },
        };
        this.emit([this.helpers.returnJsonArray(sampleData.record)]);
      },
    };
  }
}

function subscribeToPocketbaseSSE(
  this: ITriggerFunctions,
  baseUrl: string,
  collection: string,
  events: string[],
): { closeFunction: () => Promise<void> } {
  let es: EventSource | null = null;
  let isClosed = false;
  let isReconnecting = false;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 50;
  let consecutiveFailures = 0;

  const onConnect = async (e: any) => {
    try {
      const data = JSON.parse(e.data as string);
      const clientId = data.clientId;

      await this.helpers.requestWithAuthentication.call(this, "pocketbaseHttpApi", {
        method: "POST",
        url: `${baseUrl}/api/realtime`,
        body: {
          clientId,
          subscriptions: [collection],
        },
      });
      // Reset counters only after successful subscription
      reconnectAttempts = 0;
      consecutiveFailures = 0;
    } catch (error) {
      this.logger.error("Failed to connect to PocketBase SSE", { error, collection });
      const normalizedError =
        error instanceof Error ? error : new Error(String(error || "Unknown error during connect"));

      // Only emit on the first consecutive failure to avoid flooding.
      if (consecutiveFailures === 0) {
        this.emitError(normalizedError);
      }
      consecutiveFailures++;
      reconnect();
    }
  };

  const onError = (error: any) => {
    this.logger.error("PocketBase SSE connection failure", {
      error,
      baseUrl,
    });

    const normalizedError = new Error(
      (error && error.message) || "PocketBase SSE connection failure",
    );
    if (error && error.code) (normalizedError as any).code = error.code;
    if (error && error.status) (normalizedError as any).status = error.status;
    (normalizedError as any).originalErrorEvent = error;

    // Only emit error on the first failure. Subsequent reconnect attempts will not flood the error stream.
    if (consecutiveFailures === 0) {
      this.emitError(normalizedError);
    }
    consecutiveFailures++;
    reconnect();
  };

  const onMessage = (e: any) => {
    try {
      const data = JSON.parse(e.data as string);
      if (events.includes(data.action) && data.record) {
        this.emit([this.helpers.returnJsonArray(data.record)]);
      }
    } catch (error) {
      const rawData = e.data as string;
      const redactedPreview = rawData
        .replace(
          /"(password|token|secret|passwordConfirm|apiKey|accessToken|authorization|bearer)":\s*"(?:[^"\\]|\\.)*"/gi,
          '"$1": "[REDACTED]"',
        )
        .replace(/"email":\s*"(?:[^"\\]|\\.)*"/gi, '"email": "[REDACTED]"')
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED]")
        .substring(0, 200);
      this.logger.error("Failed to parse PocketBase SSE message", {
        error,
        redactedPreview,
        collection,
      });
    }
  };

  const connect = () => {
    if (isClosed) return;
    isReconnecting = false;

    es = new EventSource(`${baseUrl}/api/realtime`);

    es.addEventListener("PB_CONNECT", onConnect);
    es.addEventListener("error", onError);
    es.addEventListener(collection, onMessage);
  };

  const reconnect = () => {
    if (isClosed || isReconnecting) return;
    isReconnecting = true;

    if (es) {
      es.removeEventListener("PB_CONNECT", onConnect);
      es.removeEventListener("error", onError);
      es.removeEventListener(collection, onMessage);
      es.close();
      es = null;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error("Maximum reconnection attempts reached", { baseUrl, collection });
      this.emitError(
        new Error(
          `PocketBase SSE: Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
        ),
      );
      isClosed = true;
      isReconnecting = false;
      return;
    }

    const baseDelay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    const jitter = Math.random() * 1000; // Add 0-1000ms jitter
    const delay = baseDelay + jitter;
    reconnectAttempts++;

    reconnectTimeout = setTimeout(connect, delay);
  };

  connect();

  return {
    closeFunction: async () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) {
        es.removeEventListener("PB_CONNECT", onConnect);
        es.removeEventListener("error", onError);
        es.removeEventListener(collection, onMessage);
        es.close();
      }
    },
  };
}

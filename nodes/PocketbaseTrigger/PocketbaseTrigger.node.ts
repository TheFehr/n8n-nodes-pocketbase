import {
  ITriggerFunctions,
  ITriggerResponse,
  INodeType,
  INodeTypeDescription,
  IDataObject,
  NodeConnectionTypes,
} from "n8n-workflow";
import { EventSource, ErrorEvent as EventSourceErrorEvent } from "eventsource";
import { fetchPocketbaseToken } from "../Common/GenericFunctions";
import { LoadOptions } from "../Common/LoadOptions";

export class PocketbaseTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Pocketbase (Beta) Trigger",
    name: "pocketbaseTrigger",
    icon: { light: "file:pocketbaseTrigger.svg", dark: "file:pocketbaseTrigger.dark.svg" },
    group: ["trigger"],
    version: 1,
    description: "Handle Pocketbase events via SSE (Beta)",
    subtitle: '={{$parameter["collection"]}}',
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
        displayName: 'Collection Name or ID',
        name: "collection",
        type: "options",
        typeOptions: {
          loadOptionsMethod: "getCollections",
        },
        default: "",
        required: true,
        description: 'The name of the collection to watch for changes. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        description:
          "Applied by PocketBase before an event is sent, so the workflow only starts for the records it cares about",
        options: [
          {
            displayName: "Expand Relations",
            name: "expand",
            type: "string",
            default: "",
            placeholder: "customer,items.product",
            description: "Comma-separated relations to expand in the emitted record",
          },
          {
            displayName: "Fields",
            name: "fields",
            type: "string",
            default: "",
            placeholder: "status,total",
            description: "Comma-separated fields to return. Leave empty for all fields.",
          },
          {
            displayName: "Filter",
            name: "filter",
            type: "string",
            default: "",
            placeholder: "status = 'paid'",
            description:
              "PocketBase filter expression. Only records that match it trigger the workflow.",
          },
        ],
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

    const options = (this.getNodeParameter("options", {}) ?? {}) as {
      filter?: string;
      fields?: string;
      expand?: string;
    };
    const query: Record<string, string> = {};
    for (const key of ["filter", "fields", "expand"] as const) {
      if (options[key]) query[key] = options[key];
    }
    // PocketBase names the SSE event after the full topic, options included, so the listener must
    // be registered for exactly the string that was subscribed.
    const topic = Object.keys(query).length
      ? `${collection}?options=${encodeURIComponent(JSON.stringify({ query }))}`
      : collection;

    const { closeFunction } = subscribeToPocketbaseSSE.call(this, baseUrl, topic, events);

    // No manualTriggerFunction: in a test run n8n then waits for the first real event instead of
    // emitting made-up data that downstream nodes would be built against.
    return { closeFunction };
  }
}

// HTTP 400, 401 and 403 mean the credentials were rejected (PocketBase answers a wrong password
// with 400), which cannot succeed on a retry. The status code lives in a different place depending
// on which layer threw the error: n8n's request helper, or EventSource, which uses `code`.
function isPermanentFailure(error: unknown): boolean {
  const e = error as {
    httpCode?: string | number;
    statusCode?: number;
    status?: number;
    code?: string | number;
    response?: { status?: number };
  } | null;
  const status = Number(
    e?.httpCode ?? e?.statusCode ?? e?.status ?? e?.response?.status ?? e?.code,
  );
  return status === 400 || status === 401 || status === 403;
}

function subscribeToPocketbaseSSE(
  this: ITriggerFunctions,
  baseUrl: string,
  topic: string,
  events: string[],
): { closeFunction: () => Promise<void> } {
  let es: EventSource | null = null;
  let isClosed = false;
  let isReconnecting = false;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let stabilityTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 50;

  const onConnect = async (e: MessageEvent) => {
    const connectingStream = es;
    try {
      const data = JSON.parse(e.data as string);
      const clientId = data.clientId;

      const credentials = await this.getCredentials("pocketbaseHttpApi");
      const token = await fetchPocketbaseToken(
        (opts) => this.helpers.httpRequest(opts),
        baseUrl,
        credentials.username as string,
        credentials.password as string,
      );

      // Realtime ties the subscription's auth to this request. Without a token PocketBase treats the
      // client as a guest and never delivers events for collections whose rules aren't public.
      // eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth -- httpRequestWithAuthentication relies on the credential's `authenticate` property, which this project deliberately removed (see commit 8003c58). fetchPocketbaseToken replaces it with a reliable, cache-aware token fetch.
      await this.helpers.httpRequest({
        method: "POST",
        url: `${baseUrl}/api/realtime`,
        headers: { Authorization: token },
        body: {
          clientId,
          subscriptions: [topic],
        },
      });

      // Reset counters only after the stream has been stable for a short window
      if (stabilityTimer) clearTimeout(stabilityTimer);
      stabilityTimer = setTimeout(() => {
        reconnectAttempts = 0;
        stabilityTimer = null;
      }, 5000);
    } catch (error) {
      // A failure from a stream that has since been replaced must not tear down its replacement.
      if (isClosed || es !== connectingStream) return;
      const normalizedError =
        error instanceof Error ? error : new Error(String(error || "Unknown error during connect"));

      // Rejected credentials or a rejected request will fail the same way on every retry, so they are
      // reported at once. Everything else (connection refused, a 5xx, a server that is still starting
      // after a restart) is routine and retried; reconnect() raises an error once attempts run out.
      if (isPermanentFailure(error)) {
        this.logger.error("Failed to connect to PocketBase SSE", { error, collection: topic });
        this.emitError(normalizedError);
      } else {
        this.logger.warn("Failed to connect to PocketBase SSE, retrying", {
          error,
          collection: topic,
        });
      }
      reconnect();
    }
  };

  const onError = (error: EventSourceErrorEvent) => {
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }
    // A dropped stream is routine: PocketBase closes a connection that has been idle for five minutes.
    // emitError would make n8n deactivate the workflow, so it is reserved for failures that retrying
    // cannot fix, such as a proxy rejecting the stream; reconnect() raises one once its attempts run out.
    if (isPermanentFailure(error)) {
      this.logger.error("PocketBase rejected the SSE connection", { error, baseUrl });
      this.emitError(new Error(`PocketBase SSE: connection rejected (HTTP ${error.code})`));
    } else {
      this.logger.warn("PocketBase SSE connection lost, reconnecting", {
        error,
        baseUrl,
      });
    }
    reconnect();
  };

  const onMessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data as string);
      if (events.includes(data.action) && data.record) {
        const output: IDataObject & { __original_action?: unknown; __action?: unknown } = {
          ...data.record,
        };
        if ("action" in output) {
          output.__original_action = output.action;
        }
        output.__action = data.action;

        this.emit([this.helpers.returnJsonArray(output)]);
      }
    } catch (error) {
      const rawData = String(e?.data ?? "");
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
        collection: topic,
      });
    }
  };

  const connect = () => {
    if (isClosed) return;
    isReconnecting = false;

    es = new EventSource(`${baseUrl}/api/realtime`);

    es.addEventListener("PB_CONNECT", onConnect);
    es.addEventListener("error", onError);
    es.addEventListener(topic, onMessage);
  };

  const reconnect = () => {
    if (isClosed || isReconnecting) return;
    isReconnecting = true;

    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      stabilityTimer = null;
    }

    if (es) {
      es.removeEventListener("PB_CONNECT", onConnect);
      es.removeEventListener("error", onError);
      es.removeEventListener(topic, onMessage);
      es.close();
      es = null;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error("PocketBase trigger permanently closed after max reconnection attempts", {
        baseUrl,
        collection: topic,
        reconnectAttempts,
      });
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
      if (stabilityTimer) {
        clearTimeout(stabilityTimer);
        stabilityTimer = null;
      }
      if (es) {
        es.removeEventListener("PB_CONNECT", onConnect);
        es.removeEventListener("error", onError);
        es.removeEventListener(topic, onMessage);
        es.close();
      }
    },
  };
}

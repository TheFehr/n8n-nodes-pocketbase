import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from "n8n-workflow";
import {
  authenticatePreSend,
  collectionCreatePreSendAction,
  collectionUpdatePreSendAction,
  pagination,
} from "../Common/GenericFunctions";
import { LoadOptions } from "../Common/LoadOptions";

const collectionUrl = '=/api/collections/{{encodeURIComponent($parameter["collectionName"])}}';

export class PocketbaseAdmin implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Pocketbase Admin",
    name: "pocketbaseAdmin",
    icon: { light: "file:pocketbaseAdmin.svg", dark: "file:pocketbaseAdmin.dark.svg" },
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Manage Pocketbase collections (tables and views)",
    defaults: {
      name: "Pocketbase Admin",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: "pocketbaseHttpApi",
        required: true,
      },
    ],
    requestDefaults: {
      baseURL: '={{$credentials.url.replace(new RegExp("/$"), "")}}',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    },
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        options: [{ name: "Collection", value: "collection" }],
        default: "collection",
        noDataExpression: true,
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        displayOptions: {
          show: {
            resource: ["collection"],
          },
        },
        options: [
          {
            name: "Create",
            value: "create",
            action: "Create a collection",
            routing: {
              request: { method: "POST", url: "/api/collections" },
              send: { preSend: [authenticatePreSend, collectionCreatePreSendAction] },
            },
          },
          {
            name: "Delete",
            value: "delete",
            action: "Delete a collection",
            description: "Delete a collection together with all of its records",
            routing: {
              request: { method: "DELETE", url: collectionUrl },
              send: { preSend: [authenticatePreSend] },
              output: {
                postReceive: [{ type: "set", properties: { value: '={{ { "success": true } }}' } }],
              },
            },
          },
          {
            name: "List/Search",
            value: "search",
            action: "List or search collections",
            routing: {
              request: { method: "GET", url: "/api/collections" },
              send: { preSend: [authenticatePreSend], paginate: true },
              operations: { pagination },
            },
          },
          {
            name: "Truncate",
            value: "truncate",
            action: "Delete all records of a collection",
            description: "Delete all records of a collection, keeping the collection itself",
            routing: {
              request: { method: "DELETE", url: `${collectionUrl}/truncate` },
              send: { preSend: [authenticatePreSend] },
              output: {
                postReceive: [{ type: "set", properties: { value: '={{ { "success": true } }}' } }],
              },
            },
          },
          {
            name: "Update",
            value: "update",
            action: "Update a collection",
            routing: {
              request: { method: "PATCH", url: collectionUrl },
              send: { preSend: [authenticatePreSend, collectionUpdatePreSendAction] },
            },
          },
          {
            name: "View",
            value: "view",
            action: "View a collection",
            routing: {
              request: { method: "GET", url: collectionUrl },
              send: { preSend: [authenticatePreSend] },
            },
          },
        ],
        default: "search",
        required: true,
        noDataExpression: true,
      },
      {
        displayName: "Collection Name or ID",
        name: "collectionName",
        type: "options",
        default: "",
        required: true,
        typeOptions: {
          loadOptionsMethod: "getCollections",
        },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        displayOptions: {
          show: {
            operation: ["view", "update", "delete", "truncate"],
          },
        },
      },
      {
        displayName: "Name",
        name: "name",
        type: "string",
        default: "",
        required: true,
        description: "Name of the new collection",
        displayOptions: {
          show: {
            operation: ["create"],
          },
        },
      },
      {
        displayName: "Type",
        name: "collectionType",
        type: "options",
        options: [
          { name: "Auth", value: "auth" },
          { name: "Base", value: "base" },
          { name: "View", value: "view" },
        ],
        default: "base",
        displayOptions: {
          show: {
            operation: ["create"],
          },
        },
      },
      {
        displayName: "View Query",
        name: "viewQuery",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        required: true,
        placeholder: "SELECT id, title FROM posts",
        description: "SQL SELECT statement of the view. It must select a unique ID column.",
        displayOptions: {
          show: {
            operation: ["create"],
            collectionType: ["view"],
          },
        },
      },
      {
        displayName: "Definition",
        name: "definition",
        type: "json",
        default: "{}",
        description:
          "JSON object with further collection properties, such as <code>fields</code>, <code>indexes</code> or <code>listRule</code>. On update, <code>fields</code> replaces the whole list: fields you leave out are deleted along with their data.",
        displayOptions: {
          show: {
            operation: ["create", "update"],
          },
        },
      },
      {
        displayName: "Parameters",
        name: "parameters",
        type: "collection",
        default: {},
        displayOptions: {
          show: {
            operation: ["search"],
          },
        },
        options: [
          {
            displayName: "All Elements",
            name: "allElements",
            type: "boolean",
            default: false,
          },
          {
            displayName: "Elements per Page",
            name: "elementsPerPage",
            type: "number",
            description:
              "Maximum is 1000, the most PocketBase returns in one page. To get every element, turn on All Elements instead.",
            typeOptions: { minValue: 1, maxValue: 1000 },
            default: 30,
            routing: { send: { type: "query", property: "perPage" } },
          },
          {
            displayName: "Filter",
            name: "filter",
            type: "string",
            default: "",
            placeholder: "type = 'view'",
            routing: { send: { type: "query", property: "filter" } },
          },
          {
            displayName: "Page",
            name: "page",
            type: "number",
            typeOptions: { minValue: 1 },
            default: 1,
            routing: { send: { type: "query", property: "page" } },
          },
          {
            displayName: "Sort",
            name: "sort",
            type: "string",
            default: "",
            routing: { send: { type: "query", property: "sort" } },
          },
        ],
      },
    ],
  };

  methods = {
    loadOptions: LoadOptions,
  };
}

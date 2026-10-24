import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from "n8n-workflow";
import {
  authenticatePreSend,
  downloadRecordFiles,
  pagination,
  recordCreatePreSendAction,
  recordUpdatePreSendAction,
  recordViewPostReceiveAction,
  recordViewPreSendAction,
} from "../Common/GenericFunctions";
import { LoadOptions } from "../Common/LoadOptions";

export class PocketbaseHttp implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Pocketbase HTTP",
    name: "pocketbaseHttp",
    icon: { light: "file:pocketbaseHttp.svg", dark: "file:pocketbaseHttp.dark.svg" },
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Interact with the Pocketbase HTTP API",
    defaults: {
      name: "Pocketbase HTTP",
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
        displayName: "Collection Name or ID",
        name: "resource",
        type: "options",
        default: "",
        noDataExpression: true,
        required: true,
        typeOptions: {
          loadOptionsMethod: "getCollections",
        },
        description:
          'The Resource (PB: Collection) you are working on/with. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        options: [
          {
            name: "Create",
            value: "create",
            action: "Create an element in your collection",
            routing: {
              request: {
                method: "POST",
                url: `=/api/collections/{{$parameter["resource"]}}/records`,
              },
              send: {
                preSend: [authenticatePreSend, recordCreatePreSendAction],
              },
            },
          },
          {
            name: "Delete",
            value: "delete",
            action: "Delete an element in your collection",
            routing: {
              request: {
                method: "DELETE",
                url: `=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}`,
              },
              send: {
                preSend: [authenticatePreSend],
              },
            },
          },
          {
            name: "List/Search",
            value: "search",
            action: "List or search your collection",
            routing: {
              request: {
                method: "GET",
                url: '=/api/collections/{{$parameter["resource"]}}/records',
              },
              output: {
                postReceive: [recordViewPostReceiveAction],
              },
              send: {
                preSend: [authenticatePreSend, recordViewPreSendAction],
                paginate: true,
              },
              operations: { pagination },
            },
          },
          {
            name: "Update",
            value: "update",
            action: "Update an element in your collection",
            routing: {
              request: {
                method: "PATCH",
                url: `=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}`,
              },
              send: {
                preSend: [authenticatePreSend, recordUpdatePreSendAction],
              },
            },
          },
          {
            name: "View",
            value: "view",
            action: "View an element in your collection",
            routing: {
              request: {
                method: "GET",
                url: `=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}`,
              },
              send: {
                preSend: [authenticatePreSend, recordViewPreSendAction],
              },
              output: {
                postReceive: [downloadRecordFiles],
              },
            },
          },
        ],
        default: "search",
        required: true,
        noDataExpression: true,
      },
      {
        displayName: "Element Name or ID",
        name: "elementId",
        type: "options",
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        typeOptions: {
          loadOptionsDependsOn: ["resource"],
          loadOptionsMethod: "getRows",
        },
        default: "",
        displayOptions: {
          show: {
            operation: ["view", "update", "delete"],
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
            operation: ["search", "view", "create", "update"],
          },
        },
        options: [
          {
            displayName: "All Elements",
            name: "allElements",
            type: "boolean",
            default: false,
            displayOptions: {
              show: {
                "/operation": ["search"],
              },
            },
          },
          {
            displayName: "Download Files",
            name: "downloadFiles",
            type: "boolean",
            default: false,
            description:
              'Whether to add the files of each element as binary data, one binary field per file named after its field (multi-file fields get "_0", "_1", …). Field Names limits which files are downloaded.',
            displayOptions: {
              show: {
                "/operation": ["search", "view"],
              },
            },
          },
          {
            displayName: "Elements per Page",
            name: "elementsPerPage",
            type: "number",
            typeOptions: {
              minValue: 1,
            },
            default: 30,
            displayOptions: {
              show: {
                "/operation": ["search"],
              },
            },
            routing: {
              send: {
                type: "query",
                property: "perPage",
              },
            },
          },
          {
            // eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
            displayName: "Expand Relations",
            // eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
            description:
              'Choose from the list, or specify the Name using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            name: "relation",
            type: "multiOptions",
            default: [],
            typeOptions: {
              loadOptionsDependsOn: ["resource"],
              loadOptionsMethod: "getRelations",
            },
            displayOptions: {
              show: {
                "/operation": ["search", "view", "create", "update"],
              },
            },
            routing: {
              request: {
                qs: {
                  expand: '={{ $value ? $value.join(",") : undefined }}',
                },
              },
            },
          },
          {
            // eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options
            displayName: "Field Names",
            // eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options
            description:
              'Choose from the list, or specify Names using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
            name: "fields",
            type: "multiOptions",
            typeOptions: {
              loadOptionsDependsOn: ["resource"],
              loadOptionsMethod: "getFields",
            },
            default: [],
            displayOptions: {
              show: {
                "/operation": ["search", "view", "create", "update"],
              },
            },
            routing: {
              request: {
                qs: {
                  fields: '={{ $value ? $value.join(",") : undefined }}',
                },
              },
            },
          },
          {
            displayName: "Filter",
            name: "filter",
            type: "string",
            default: "",
            displayOptions: {
              show: {
                "/operation": ["search"],
              },
            },
            routing: {
              send: {
                type: "query",
                property: "filter",
              },
            },
          },
          {
            displayName: "Page",
            name: "page",
            type: "number",
            typeOptions: {
              minValue: 1,
            },
            default: 1,
            displayOptions: {
              show: {
                "/operation": ["search"],
              },
            },
            routing: {
              send: {
                type: "query",
                property: "page",
              },
            },
          },
          {
            displayName: "Sort",
            name: "sort",
            type: "string",
            default: "",
            displayOptions: {
              show: {
                "/operation": ["search"],
              },
            },
            routing: {
              send: {
                type: "query",
                property: "sort",
              },
            },
          },
        ],
      },
      {
        displayName: "Body Type",
        name: "bodyType",
        type: "multiOptions",
        displayOptions: {
          show: {
            operation: ["create", "update"],
          },
        },
        default: ["fields"],
        options: [
          {
            name: "Fields",
            value: "fields",
          },
          {
            name: "JSON Body",
            value: "bodyJson",
          },
          {
            name: "Binary Data",
            value: "binaryData",
          },
        ],
      },
      {
        displayName: "Fields",
        name: "fields",
        type: "assignmentCollection",
        displayOptions: {
          show: {
            operation: ["create", "update"],
            bodyType: ["fields"],
          },
        },
        default: [],
        description: "Add fields to be sent. To clear a field, use an expression: <code>={{ null }}</code>.",
      },
      {
        displayName: "JSON Body",
        name: "bodyJson",
        type: "json",
        displayOptions: {
          show: {
            operation: ["create", "update"],
            bodyType: ["bodyJson"],
          },
        },
        default: "",
        placeholder: "Body according to the collection's schema",
        description: "JSON object to be sent. To clear a field, use <code>null</code> as value: <code>{\"myField\": null}</code>.",
      },
      {
        displayName: "Binary Property Name",
        name: "binaryPropertyName",
        type: "string",
        default: "data",
        displayOptions: {
          show: {
            operation: ["create", "update"],
            bodyType: ["binaryData"],
          },
        },
        description: "Name of the binary property which contains the data to be sent",
      },
      {
        displayName: "Binary Field Name",
        name: "binaryFieldName",
        type: "string",
        default: "",
        displayOptions: {
          show: {
            operation: ["create", "update"],
            bodyType: ["binaryData"],
          },
        },
        description:
          "Name of the binary field according to the collection's schema. If left empty, the binary data will be sent as a file attachment.",
      },
    ],
  };

  methods = {
    loadOptions: LoadOptions,
  };
}

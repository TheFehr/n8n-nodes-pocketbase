import { describe, it, expect } from "vitest";
import { NodeHelpers, type INode, type INodeProperties } from "n8n-workflow";
import { PocketbaseHttp } from "../nodes/PocketbaseHttp/PocketbaseHttp.node";

const { description } = new PocketbaseHttp();
const parametersCollection = description.properties.find(
  (property) => property.name === "parameters",
) as INodeProperties;

/** Builds a minimal Pocketbase HTTP node with the given operation selected. */
function makeNode(operation: string): INode {
  return {
    id: "test",
    name: "Pocketbase HTTP",
    type: "pocketbaseHttp",
    typeVersion: 1,
    position: [0, 0],
    parameters: { resource: "posts", operation },
  };
}

/**
 * Whether n8n displays the property for the given operation.
 * Mirrors the check n8n's RoutingNode runs before sending a parameter.
 */
function isDisplayed(property: INodeProperties, operation: string): boolean {
  const node = makeNode(operation);
  return NodeHelpers.displayParameter(
    node.parameters,
    property,
    node,
    description,
    node.parameters,
  );
}

/** Names of the Parameters collection options displayed for the given operation, sorted. */
function visibleOptions(operation: string): string[] {
  if (!isDisplayed(parametersCollection, operation)) return [];
  return (parametersCollection.options as INodeProperties[])
    .filter((option) => isDisplayed(option, operation))
    .map((option) => option.name)
    .sort();
}

describe("PocketbaseHttp parameters", () => {
  it("shows every option for List/Search", () => {
    const allOptions = (parametersCollection.options as INodeProperties[])
      .map((option) => option.name)
      .sort();
    expect(visibleOptions("search")).toEqual(allOptions);
  });

  it("shows only download files, expand and fields for view", () => {
    expect(visibleOptions("view")).toEqual(["downloadFiles", "fields", "relation"]);
  });

  it.each(["create", "update"])("shows only expand and fields for %s", (operation) => {
    expect(visibleOptions(operation)).toEqual(["fields", "relation"]);
  });

  it("hides the parameters collection for delete", () => {
    expect(visibleOptions("delete")).toEqual([]);
  });

  it("limits Elements per Page to the range PocketBase accepts", () => {
    const elementsPerPage = (parametersCollection.options as INodeProperties[]).find(
      (option) => option.name === "elementsPerPage",
    )!;

    expect(elementsPerPage.typeOptions).toMatchObject({ minValue: 1, maxValue: 1000 });
  });

  it("reloads collection-dependent dropdowns when the collection changes", () => {
    const dependsOn = (property: INodeProperties) => property.typeOptions?.loadOptionsDependsOn;
    const elementId = description.properties.find((property) => property.name === "elementId")!;
    const options = parametersCollection.options as INodeProperties[];

    expect(dependsOn(elementId)).toEqual(["resource"]);
    expect(dependsOn(options.find((option) => option.name === "relation")!)).toEqual(["resource"]);
    expect(dependsOn(options.find((option) => option.name === "fields")!)).toEqual(["resource"]);
  });

  it("leaves Download Files off by default", () => {
    const options = parametersCollection.options as INodeProperties[];

    expect(options.find((option) => option.name === "downloadFiles")!.default).toBe(false);
  });
});

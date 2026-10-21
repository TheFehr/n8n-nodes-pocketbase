import { describe, it, expect } from "vitest";
import { NodeHelpers, type INode, type INodeProperties } from "n8n-workflow";
import { PocketbaseHttp } from "../nodes/PocketbaseHttp/PocketbaseHttp.node";

const { description } = new PocketbaseHttp();
const parametersCollection = description.properties.find(
  (property) => property.name === "parameters",
) as INodeProperties;

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

// Mirrors the check n8n's RoutingNode runs before sending a parameter
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

function visibleOptions(operation: string): string[] {
  if (!isDisplayed(parametersCollection, operation)) return [];
  return (parametersCollection.options as INodeProperties[])
    .filter((option) => isDisplayed(option, operation))
    .map((option) => option.name)
    .sort();
}

describe("PocketbaseHttp parameters", () => {
  it("shows all list options for List/Search", () => {
    expect(visibleOptions("search")).toEqual(
      ["allElements", "elementsPerPage", "fields", "filter", "page", "relation", "sort"].sort(),
    );
  });

  it.each(["view", "create", "update"])("shows only expand and fields for %s", (operation) => {
    expect(visibleOptions(operation)).toEqual(["fields", "relation"]);
  });

  it("hides the parameters collection for delete", () => {
    expect(visibleOptions("delete")).toEqual([]);
  });

  it("reloads collection-dependent dropdowns when the collection changes", () => {
    const dependsOn = (property: INodeProperties) => property.typeOptions?.loadOptionsDependsOn;
    const elementId = description.properties.find((property) => property.name === "elementId")!;
    const options = parametersCollection.options as INodeProperties[];

    expect(dependsOn(elementId)).toEqual(["resource"]);
    expect(dependsOn(options.find((option) => option.name === "relation")!)).toEqual(["resource"]);
    expect(dependsOn(options.find((option) => option.name === "fields")!)).toEqual(["resource"]);
  });
});

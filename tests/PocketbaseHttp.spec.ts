import { describe, it, expect } from "vitest";
import { PocketbaseHttp } from "../nodes/PocketbaseHttp/PocketbaseHttp.node";

interface OperationOption {
  name: string;
  value: string;
  action?: string;
  routing: {
    request: { method: string; url: string };
    send?: { paginate?: boolean };
  };
}

function getOperationOptions(node: PocketbaseHttp): OperationOption[] {
  const operationProperty = node.description.properties.find(
    (property) => property.name === "operation",
  );
  if (!operationProperty || !Array.isArray(operationProperty.options)) {
    throw new Error("Expected 'operation' property with an options array");
  }
  return operationProperty.options as unknown as OperationOption[];
}

describe("PocketbaseHttp", () => {
  const node = new PocketbaseHttp();

  // The PR reordered the operation options (Create moved to the top, Update
  // and View swapped places) purely for display purposes. These tests lock
  // in that each operation still carries its own correct routing regardless
  // of where it sits in the list.
  it("lists operations in Create, List/Search, Update, View order", () => {
    const values = getOperationOptions(node).map((option) => option.value);
    expect(values).toEqual(["create", "search", "update", "view"]);
  });

  it("routes 'create' to POST /records", () => {
    const create = getOperationOptions(node).find((option) => option.value === "create")!;
    expect(create.routing.request.method).toBe("POST");
    expect(create.routing.request.url).toBe('=/api/collections/{{$parameter["resource"]}}/records');
  });

  it("routes 'search' to a paginated GET /records", () => {
    const search = getOperationOptions(node).find((option) => option.value === "search")!;
    expect(search.routing.request.method).toBe("GET");
    expect(search.routing.request.url).toBe('=/api/collections/{{$parameter["resource"]}}/records');
    expect(search.routing.send?.paginate).toBe(true);
  });

  it("routes 'update' to PATCH /records/{elementId}", () => {
    const update = getOperationOptions(node).find((option) => option.value === "update")!;
    expect(update.routing.request.method).toBe("PATCH");
    expect(update.routing.request.url).toBe(
      '=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}',
    );
  });

  it("routes 'view' to GET /records/{elementId}", () => {
    const view = getOperationOptions(node).find((option) => option.value === "view")!;
    expect(view.routing.request.method).toBe("GET");
    expect(view.routing.request.url).toBe(
      '=/api/collections/{{$parameter["resource"]}}/records/{{$parameter["elementId"]}}',
    );
  });

  it("each operation value is unique", () => {
    const values = getOperationOptions(node).map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
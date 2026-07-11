import { describe, it, expect, vi, beforeEach } from "vitest";

// scripts/bundle-vendor-deps.mjs runs its bundling work as a top-level side
// effect on import (it has no exports), so these tests mock esbuild's
// `build` function and re-import the module fresh for each test to observe
// how it was invoked.
const buildMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("esbuild", () => ({
  build: buildMock,
}));

describe("scripts/bundle-vendor-deps.mjs", () => {
  beforeEach(() => {
    vi.resetModules();
    buildMock.mockClear();
  });

  it("bundles both vendored entry points, keeping n8n-workflow and local relative imports external", async () => {
    await import("../scripts/bundle-vendor-deps.mjs");
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(2));

    expect(buildMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        entryPoints: ["dist/nodes/Common/RequestBodyFunctions.js"],
        outfile: "dist/nodes/Common/RequestBodyFunctions.js",
        bundle: true,
        platform: "node",
        format: "cjs",
        allowOverwrite: true,
        external: ["n8n-workflow"],
      }),
    );

    expect(buildMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        entryPoints: ["dist/nodes/PocketbaseTrigger/PocketbaseTrigger.node.js"],
        outfile: "dist/nodes/PocketbaseTrigger/PocketbaseTrigger.node.js",
        bundle: true,
        platform: "node",
        format: "cjs",
        allowOverwrite: true,
        external: ["n8n-workflow", "../Common/LoadOptions"],
      }),
    );
  });

  it("does not mark eventsource or form-data as external, so they get inlined into the compiled output", async () => {
    await import("../scripts/bundle-vendor-deps.mjs");
    await vi.waitFor(() => expect(buildMock).toHaveBeenCalledTimes(2));

    for (const call of buildMock.mock.calls) {
      const options = call[0] as { external: string[] };
      expect(options.external).not.toContain("eventsource");
      expect(options.external).not.toContain("form-data");
    }
  });
});
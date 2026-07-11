import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// scripts/update-versions.ts has no exports and runs main() as a top-level
// side effect on import, so these tests mock fs + fetch and re-import the
// module fresh for each case to observe what it reads/writes/logs.
const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("fs", () => fsMocks);

const PACKAGE_NAME = "n8n-nodes-pocketbase";

function readFileFixture(fixtures: Record<string, string>) {
  return (path: string) => {
    const match = Object.entries(fixtures).find(([suffix]) => path.endsWith(suffix));
    if (!match) {
      throw new Error(`Unexpected readFileSync path in test: ${path}`);
    }
    return match[1];
  };
}

function buildFixtures(overrides: {
  n8nWorkflowVersion: string;
  pocketbaseVersion: string;
}) {
  const packageJson = {
    name: PACKAGE_NAME,
    n8nWorkflowVersion: overrides.n8nWorkflowVersion,
    pocketbaseVersion: overrides.pocketbaseVersion,
    peerDependencies: { "n8n-workflow": "*" },
  };

  return {
    "package.json": JSON.stringify(packageJson),
    "README.md":
      `# ${PACKAGE_NAME}\n\nSome description.\n\n` +
      `This was developed for version 1.111.0 of n8n and version 0.39.5 of PocketBase.\n`,
    "docker-compose.test.yml":
      "image: ghcr.io/muchobien/pocketbase:0.39.5\n" +
      "image: n8nio/n8n:1.111.0\n" +
      `ln -sf /home/node/custom-nodes /home/node/.n8n/nodes/node_modules/${PACKAGE_NAME}\n`,
    "integration_test.json": JSON.stringify(
      {
        nodes: [{ type: `${PACKAGE_NAME}.pocketbaseHttp` }],
      },
      null,
      2,
    ),
    "PocketbaseHttp.node.json": JSON.stringify({ node: `${PACKAGE_NAME}-http` }, null, 2),
  };
}

function mockFetchWith(dependencies: Record<string, string>) {
  return vi.fn(async (url: string) => {
    if (url.includes("pocketbase/pocketbase")) {
      return {
        ok: true,
        json: async () => ({ tag_name: "v0.39.5" }),
      };
    }
    if (url.includes("registry.npmjs.org/n8n")) {
      return {
        ok: true,
        json: async () => ({ version: "1.111.0", dependencies }),
      };
    }
    throw new Error(`Unexpected fetch url in test: ${url}`);
  });
}

describe("scripts/update-versions.ts", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    fsMocks.readFileSync.mockReset();
    fsMocks.writeFileSync.mockReset();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports everything up to date when n8nWorkflowVersion already matches n8n's bundled n8n-workflow dependency", async () => {
    vi.stubGlobal("fetch", mockFetchWith({ "n8n-workflow": "2.28.7" }));
    fsMocks.readFileSync.mockImplementation(
      readFileFixture(
        buildFixtures({ n8nWorkflowVersion: "2.28.7", pocketbaseVersion: "0.39.5" }),
      ),
    );

    await import("../scripts/update-versions.ts");

    await vi.waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Everything is up to date.")),
    );

    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("syncs n8nWorkflowVersion to the n8n-workflow dependency version, not to n8n's own release version", async () => {
    vi.stubGlobal("fetch", mockFetchWith({ "n8n-workflow": "2.28.7" }));
    fsMocks.readFileSync.mockImplementation(
      // n8nWorkflowVersion is stale; everything else already matches so the
      // only write we expect is to package.json.
      readFileFixture(
        buildFixtures({ n8nWorkflowVersion: "2.20.0", pocketbaseVersion: "0.39.5" }),
      ),
    );

    await import("../scripts/update-versions.ts");

    await vi.waitFor(() => expect(fsMocks.writeFileSync).toHaveBeenCalled());

    const packageJsonWrite = fsMocks.writeFileSync.mock.calls.find((call) =>
      String(call[0]).endsWith("package.json"),
    );
    expect(packageJsonWrite).toBeDefined();

    const written = JSON.parse(packageJsonWrite![1] as string);
    expect(written.n8nWorkflowVersion).toBe("2.28.7");
    expect(written.n8nWorkflowVersion).not.toBe("1.111.0");
    // peerDependencies.n8n-workflow must stay "*" for community-node compliance.
    expect(written.peerDependencies["n8n-workflow"]).toBe("*");

    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("fails loudly when n8n's package metadata is missing an n8n-workflow dependency entry", async () => {
    vi.stubGlobal("fetch", mockFetchWith({}));
    fsMocks.readFileSync.mockImplementation(
      readFileFixture(
        buildFixtures({ n8nWorkflowVersion: "2.28.7", pocketbaseVersion: "0.39.5" }),
      ),
    );

    await import("../scripts/update-versions.ts");

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

    expect(errorSpy).toHaveBeenCalledWith(
      "Error updating versions:",
      expect.objectContaining({
        message: expect.stringContaining("has no n8n-workflow dependency"),
      }),
    );
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});
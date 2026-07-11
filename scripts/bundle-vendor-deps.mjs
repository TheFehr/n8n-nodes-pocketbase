import { build } from "esbuild";

// Community nodes must not declare runtime "dependencies" (they'd get bundled
// into the host n8n instance and can conflict with other nodes or n8n itself).
// eventsource and form-data are genuinely needed at runtime, so instead of
// requiring them from node_modules, inline their code directly into the two
// compiled files that use them. Everything else (n8n-workflow, local relative
// imports) stays a normal require - only these two npm packages get vendored.
const targets = [
  {
    entry: "dist/nodes/Common/RequestBodyFunctions.js",
    external: ["n8n-workflow"],
  },
  {
    entry: "dist/nodes/PocketbaseTrigger/PocketbaseTrigger.node.js",
    external: ["n8n-workflow", "../Common/LoadOptions"],
  },
];

for (const { entry, external } of targets) {
  await build({
    entryPoints: [entry],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    allowOverwrite: true,
    sourcemap: true,
    external,
    logLevel: "info",
  });
}

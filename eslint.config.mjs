import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
  ...configWithoutCloudSupport,
  {
    // scripts/ holds standalone CLI tooling (run via tsx, not bundled into the
    // node), where console output is the point rather than something to avoid.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Diagnostic output for a real e2e run against a live PocketBase instance.
    files: ['tests/PocketbaseTriggerIntegration.spec.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

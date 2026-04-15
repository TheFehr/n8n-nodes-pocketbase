import n8nNodesBase from "eslint-plugin-n8n-nodes-base";

export default {
  plugins: {
    "n8n-nodes-base": n8nNodesBase,
  },
  rules: {
    "n8n-nodes-base/node-param-display-name-miscased": "error",
  },
};

# n8n-nodes-pocketbase

This is a n8n community node. It lets you use PocketBase in your n8n workflows.

PocketBase is an open source backend consisting of embedded database (SQLite) with realtime subscriptions, built-in auth management, convenient dashboard UI and simple REST-ish API.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)
[Compatibility](#compatibility)  
[Development](#development)  
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

Nearly all PocketBase operations for Base collections should be implemented.

### Trigger Node (Beta)

This node allows you to subscribe to PocketBase events (create, update, delete) in real-time via Server-Sent Events (SSE). 

**Note**: The trigger node is currently in Beta. We've implemented basic reconnection logic, but it may still be sensitive to network interruptions or large amounts of data. Please use with caution in production.

## Credentials

Ensure you have an Auth collection in your PocketBase defined and the "Username/Password" Auth method turned on.  
Alternatively, you can use your administrator account and the "\_superusers" collection which PocketBase creates automatically since [v0.23.0](https://github.com/pocketbase/pocketbase/releases/tag/v0.23.0).

## Compatibility

This was developed for version 2.16.2 of n8n and version 0.37.2 of PocketBase.

## Development

This project uses modern tooling for development:

- **Linting**: [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for fast linting.
- **Formatting**: [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for fast formatting.
- **Testing**: [vitest](https://vitest.dev/) for unit and integration tests.

### Scripts

- `npm run lint`: Lint the project.
- `npm run format`: Format the project.
- `npm test`: Run tests.
- `npm run test:pipeline`: Run a full integration test against a PocketBase instance in Docker and update the compatibility section in `README.md`.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [PocketBase Introduction](https://pocketbase.io/docs/)

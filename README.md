# n8n-nodes-pocketbase

This is a n8n community node. It lets you use PocketBase in your n8n workflows.

PocketBase is an open source backend consisting of embedded database (SQLite) with realtime subscriptions, built-in auth management, convenient dashboard UI and simple REST-ish API.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Usage Tips](#usage-tips)  
[Operations](#operations)  
[Credentials](#credentials)
[Compatibility](#compatibility)  
[Development](#development)  
[Resources](#resources)

## Usage Tips

### Clearing Fields
To clear a field (set it to its zero-value or delete a file), you can send `null` as the value:
- **Text/Number/Select/Relation**: Use an expression to return `null` to clear the field.
- **JSON**: Use `null` to store a literal null value.
- **File**: Use `null` to delete the existing file.

In the **Fields** parameter, use an expression: `={{ null }}`.  
In the **JSON Body**, use the literal `null`: `{"myField": null}`.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

Nearly all PocketBase operations for Base collections should be implemented.

### Download Files

Turn on **Download Files** under **Parameters** of View or List/Search to get the files of each element as binary data on its item. A single-file field becomes a binary field of the same name, a multi-file field becomes `<field>_0`, `<field>_1` and so on. Protected files are supported. To download only some files, pick the fields with **Field Names** (include `id`).

### Trigger Node (Beta)

This node allows you to subscribe to PocketBase events (create, update, delete) in real-time via Server-Sent Events (SSE).

- **Options**: **Filter**, **Fields** and **Expand Relations** are applied by PocketBase before an event is sent, so the workflow only starts for the records it needs. The filter uses the same syntax as the List operation, for example `status = 'paid'`.
- **Testing**: a test run in the editor waits for the first real event from your collection, so create or change a record to finish it.
- **Dropped connections**: PocketBase closes a stream after five idle minutes. The node reconnects by itself and the workflow stays active. It reports an error, and so makes n8n deactivate the workflow, when PocketBase rejects the credentials (HTTP 400, 401 or 403), or after it has failed to reconnect 50 times in a row. A server that is still starting up, or a refused connection, is simply retried. PocketBase does not replay events, so a change made in the second or two while the node reconnects is not delivered.

**Note**: The trigger node is currently in Beta. We've implemented basic reconnection logic, but it may still be sensitive to network interruptions or large amounts of data. Please use with caution in production.

## Credentials

Ensure you have an Auth collection in your PocketBase defined and the "Username/Password" Auth method turned on.  
Alternatively, you can use your administrator account and the "\_superusers" collection which PocketBase creates automatically since [v0.23.0](https://github.com/pocketbase/pocketbase/releases/tag/v0.23.0).

## Compatibility

- **PocketBase 0.23.0 or newer.** The node signs in through the `_superusers` collection, which PocketBase introduced in 0.23.0.
- **n8n 1.85.0 or newer.** Older versions can't load the node, because it uses `NodeConnectionTypes`, which n8n added in 1.85.0.

When a new n8n or PocketBase version comes out, a nightly job runs the integration tests against it and releases an update once they pass.

<!-- n8n-node-tooling:compatibility -->
Last tested with n8n 2.46.7 and PocketBase 0.40.6.
<!-- /n8n-node-tooling:compatibility -->

## Versioning

The package version mirrors the PocketBase it was last tested with, shifted by two in the major: `major.minor` is `(PocketBase major + 2).(PocketBase minor)`, so `2.40.x` goes with PocketBase `0.40`. The patch number is this package's own counter.

- Every change to the node, **including breaking ones**, only bumps the patch. Breaking changes are called out in the release notes, not in the version number. Read the notes before updating.
- When PocketBase's major or minor version changes, the next release is the matching `<major>.<minor>.0`, after the nightly compatibility check has passed against the new PocketBase.

Versions before `2.40.0` used an independent numbering (`2.3.x`). `2.40.0` is numerically higher than any of them, so updates are not blocked.

## Development

This project uses modern tooling for development:

- **Linting**: [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for fast linting.
- **Formatting**: [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for fast formatting.
- **Testing**: [vitest](https://vitest.dev/) for unit and integration tests.

### Scripts

- `npm run lint`: Lint the project.
- `npm run format`: Format the project.
- `npm test`: Run tests.
- `npm run test:pipeline`: Run a full integration test against a PocketBase instance in Docker. It also publishes a workflow with the Trigger node in a real n8n, drives PocketBase through its API (create, update, delete, a dropped stream) and checks the files that workflow writes.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [PocketBase Introduction](https://pocketbase.io/docs/)

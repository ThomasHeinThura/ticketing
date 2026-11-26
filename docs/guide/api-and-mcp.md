---
title: API and MCP
---

# API and MCP

TaskDesk has a REST API under `/api` on the agent host. Everything the web app does goes through it. The MCP server wraps the same API for AI assistants.

## API keys

Keys authenticate as a bearer token:

```sh
curl -H "Authorization: Bearer tdk_..." \
  "https://ticket.example.com/api/project?workspaceId=<workspace id>"
```

There are two kinds:

- Personal keys act as you. Create one in the agent app under Account, Developer. You must be signed in as staff in a browser session, because a key cannot create keys. A personal key is read-only unless you request write capabilities. It can never do more than you can do right now, even if your role shrinks later.
- Service keys belong to a workspace and carry an explicit capability list. They are managed through `/api/workspaces/{id}/api-keys`.

The full key is shown once, at creation. Both kinds accept an expiry, an IP allowlist and a per-minute rate limit. Revoking a key takes effect immediately and keeps its row for the audit log. Deleting a key opens a pending action that you approve in the browser. God Mode, API keys lists every key on the instance.

Deleting data with a key never happens in one step. A delete request returns `202` with a pending action id, and the key's owner approves it in the web app.

## OpenAPI document

The API describes itself at `GET /api/openapi` on the agent host. The endpoint needs no credentials and serves only the schema. The document also covers the SCIM endpoints at `/scim/v2`, which use their own bearer token.

The repository keeps a committed copy at `tests/api-contract/openapi.json`, and CI fails when the running API drifts from it. Regenerate it with `pnpm openapi:write` after an API change.

Some write routes need a browser session and a CSRF token, and a few need fresh step-up verification, so an API key cannot call them. The OpenAPI document marks the routes that accept keys.

## Approvals, users and pending actions

Two areas follow the same pattern as deletion. Approvals are requested with `POST /api/work-items/{key}/approvals` and decided by the named approver with `POST /api/approvals/{id}/decide`. An instance administrator can list accounts with `GET /api/instance/users`. Deactivation (`POST /api/instance/users/{id}/deactivate`) creates a pending action that the same administrator approves in the browser with a fresh verification.

## MCP server

`@taskdesk/mcp` is a stdio MCP server. Turn on `feature.mcp` in God Mode, Features first, because it is off by default.

1. In the agent app, open Account, Developer and create a key with the "Use with an AI agent" option. Grant only the capabilities the assistant needs. Ticket text comes from customers, so a key that can change work can be steered by a hostile ticket.
2. Register the server in your MCP client:

   ```sh
   npx @taskdesk/mcp
   ```

   In a terminal this runs an installer. It can write the entry for Cursor, Claude Desktop or a custom config file. Skip the prompts with `taskdesk-mcp install --target <id> --api-url <url> -y`, or run `taskdesk-mcp install --help` for the targets. The installer writes only the API URL, so add `TASKDESK_API_KEY` to the entry's environment yourself.

3. The client starts the server with these environment variables:

   | Variable | Meaning |
   | --- | --- |
   | `TASKDESK_API_KEY` | Required. The only supported authentication. |
   | `TASKDESK_API_URL` | Origin of your agent host. Defaults to `http://localhost:1337`, so set it for any real install. |

`taskdesk-mcp serve` runs the server directly when you want to test stdio. Tools cover projects, work items, states, comments, labels, relations, time logging, approvals, saved views and imports. Deleting tools only ask TaskDesk to open a pending deletion, and the key's owner approves it in the web app. See `packages/mcp/README.md` for the full package notes.

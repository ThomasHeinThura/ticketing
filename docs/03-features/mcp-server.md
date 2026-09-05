# MCP server

- **Phase:** P4
- **Status:** ⬜
- **Feature flag:** `feature.mcp`
- **Depends on:** API keys, RBAC

## Purpose

Let AI agents read and change work through the Model Context Protocol, with the same
permissions as a person.

Two audiences:

1. **Everyday use** — someone asks their assistant "what's assigned to me and breaching
   today?" or "raise a ticket for the printer in Ward 3".
2. **Data import** — an agent reads Azure DevOps or Plane through *their* MCP servers and
   writes into TaskDesk through ours, handling the messy mapping that a rigid importer
   cannot. See [import strategy](../06-data-import/import-strategy.md).

Both kaneo and v1 shipped an MCP server, so this is a continuation rather than a novelty.

## Architecture

```
Agent (Claude, Copilot, …)
   │  stdio
   ▼
@taskdesk/mcp  ── HTTP + Bearer API key ──►  /api/*
```

The MCP server is a **thin client over the public API**. It holds no business logic and
has no privileged database access. Everything it can do, a person with the same API key
could do through the same endpoints.

This is the important property: there is **one** authorization surface, not two. An MCP
server with its own data access would be a second place for authorization bugs to hide,
and it would inevitably drift.

## Authentication

- `MC-1` An API key, created under profile settings with an explicit capability subset.
- `MC-2` The key can never exceed its owner's authority. See
  [webhooks and API keys](webhooks-and-api-keys.md).
- `MC-3` OAuth device flow is offered as an alternative for interactive setup, so a user
  need not paste a key.
- `MC-4` Every MCP request is audited with the key's identity, and the audit row is marked
  as agent-originated.

## Tools

Read:

```
list_workspaces          list_projects            get_project
search_work_items        get_work_item            list_my_work
get_work_item_activity   list_states              list_work_item_types
list_request_types       list_people              get_sla_status
list_approvals           list_saved_views
```

Write:

```
create_work_item         update_work_item         transition_work_item
assign_work_item         add_comment              add_label
create_relation          set_custom_field         create_submission
decide_approval          log_time
```

Import-oriented:

```
bulk_create_work_items   create_import_mapping    get_import_mapping
```

## Behaviour

- `MC-5` Every write tool requires an `Idempotency-Key`. Agents retry, and a retried
  `create_work_item` must not produce two work items. This is not optional.
- `MC-6` Tool descriptions state permissions and side effects plainly, because the model
  reads them and will otherwise guess.
- `MC-7` Destructive tools — delete, bulk operations above 50 items — require an explicit
  `confirm: true` argument. The friction is deliberate.
- `MC-8` Errors are returned as readable text, not raw JSON problem documents. An agent
  recovers better from "You can't assign work in this project — you need the assign
  permission" than from a status code.
- `MC-9` Responses are compact. Full descriptions and activity are fetched only when
  explicitly requested, because context windows are finite and an agent that burns its
  context on boilerplate becomes useless.
- `MC-10` Rate limited per key, more strictly than the human API, because an agent in a
  loop is a realistic failure mode.

## Distribution

- `MC-11` Published to npm as `@taskdesk/mcp` with a `taskdesk-mcp` binary.
- `MC-12` Configured by environment: `TASKDESK_API_URL`, `TASKDESK_API_KEY`.
- `MC-13` An interactive `taskdesk-mcp setup` walks through URL and authentication.
- `MC-14` The instance can be disabled from serving MCP entirely with `feature.mcp`.

## Screens

Under profile settings: API keys, with an "Use with an AI agent" section giving a
copy-pasteable configuration block for common clients.

In God Mode: MCP usage — which keys, how many calls, which tools, error rates.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Agent retries after a timeout | Idempotency key returns the original result |
| Agent requests 10,000 work items | Paginated with a hard cap; the response says how to page |
| Agent attempts something beyond its key | Refused with a readable explanation of what is missing |
| Agent loops creating work items | Rate limit; a burst above threshold disables the key and notifies the owner |
| Key revoked mid-session | The next call fails with a clear message |
| Tool renamed between versions | Old names kept as aliases for two minor releases |

## Testing

Integration: every MCP tool respects the same policy as its underlying route; idempotency
prevents duplicates under retry; capability clamping holds.

E2E: a scripted agent session creates, comments on and transitions a work item, and a
second identical run creates nothing new.

## Related

- [Webhooks and API keys](webhooks-and-api-keys.md) · [API design](../01-architecture/api-design.md)
- [Import strategy](../06-data-import/import-strategy.md)

# @taskdesk/mcp

An MCP (Model Context Protocol) server for TaskDesk. It lets an MCP client such as Cursor or Claude read and update projects and work items through the TaskDesk API, using a TaskDesk API key.

The server talks to your own TaskDesk install over stdio. It needs TaskDesk running, with the `feature.mcp` flag on in God Mode, Features.

## Create an API key

In the TaskDesk agent app, open Account, Developer and create a key with the "Use with an AI agent" option. Grant only the capabilities the assistant needs. A key is read-only unless you request write capabilities, and it never exceeds your own access. The key is shown once.

Ticket text is written by customers, so an assistant holding a key that can change work can be steered by a hostile ticket. Keep write access narrow.

## Register the server

```sh
npx @taskdesk/mcp
```

In a terminal this starts an installer that writes the server entry into the config of Cursor, Claude Desktop or a file you choose. To skip the prompts:

```sh
taskdesk-mcp install --target <target> --api-url https://ticket.example.com -y
```

The targets are `cursor-user`, `cursor-project`, `claude-desktop` and `custom`. Run `taskdesk-mcp install --help` for the `--output`, `--project-dir` and `--name` options. The installer does not write your key. Add `TASKDESK_API_KEY` to the entry's environment yourself.

You can also write the entry by hand:

```json
{
  "mcpServers": {
    "taskdesk": {
      "command": "npx",
      "args": ["-y", "@taskdesk/mcp"],
      "env": {
        "TASKDESK_API_URL": "https://ticket.example.com",
        "TASKDESK_API_KEY": "tdk_..."
      }
    }
  }
}
```

## Environment

| Variable | Meaning |
| --- | --- |
| `TASKDESK_API_KEY` | Required. An API key is the only supported way to authenticate. |
| `TASKDESK_API_URL` | Origin of the agent host. Defaults to `http://localhost:1337`. |

## Commands

| Command | Does |
| --- | --- |
| `taskdesk-mcp` | Installer in a terminal, server when stdin is piped |
| `taskdesk-mcp install` | Register the server in an MCP client config |
| `taskdesk-mcp serve` | Run the stdio server |
| `taskdesk-mcp help` | Show help |

## Tools

Read tools: `whoami`, `list_projects`, `get_project`, `search_work_items`, `get_work_item`, `list_states`, `list_work_item_types`, `list_work_item_transitions`, `list_request_types`, `list_people`, `list_time_activities`, `get_sla_status`, `list_approvals`, `list_saved_views`, `list_work_item_relations`, `get_import_link`, `get_pending_action`.

Write tools: `create_work_item`, `bulk_create_work_items`, `update_work_item`, `set_custom_field`, `add_label`, `transition_work_item`, `assign_work_item`, `add_comment`, `log_time`, `create_relation`, `decide_approval`, `create_import_link`.

Delete tools: `delete_work_item`, `delete_comment`, `delete_relation`. These never delete. They ask TaskDesk to open a pending action, and the key's owner approves it in the TaskDesk web app. Use `get_pending_action` to check the outcome.

Every call runs with the key's own capabilities, so the server can do nothing that the key could not do through the API.

## Licence

MIT, see `LICENSE`.

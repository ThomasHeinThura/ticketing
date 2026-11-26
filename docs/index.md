---
title: TaskDesk documentation
---

# TaskDesk documentation

TaskDesk is a self-hosted service desk and work-management platform. Staff run projects and triage requests in the agent app. Customers submit and follow requests in a separate portal. One container image serves both, and administrators set the rest up from the browser.

## Guides

| Guide | For |
| --- | --- |
| [Install and deploy](guide/install-and-deploy.md) | Whoever runs the server: Docker Compose, HTTPS, signed images, upgrade, backup and restore |
| [Administration](guide/administration.md) | Instance and workspace administrators: first owner, roles, portal, SSO, SCIM, 2FA, email |
| [Agent guide](guide/agent-guide.md) | Staff: projects, work items, triage, time, approvals, reports, knowledge base |
| [Portal guide](guide/portal-guide.md) | Customers: catalogue, submitting and tracking requests, account |
| [API and MCP](guide/api-and-mcp.md) | Developers: API keys, the OpenAPI document, the MCP server |
| [Troubleshooting](guide/troubleshooting.md) | Common start-up, sign-in and upgrade problems |

## Two hosts

The agent app and the portal run on different hostnames with separate session cookies. The agent host serves staff screens, `/god-mode` for instance administration and the API under `/api`. The portal host serves customer pages at its root, such as `/requests` and `/catalogue`.

Most features start switched off. An instance administrator turns them on under God Mode, Features, and workspace or project settings can override them where the feature allows.

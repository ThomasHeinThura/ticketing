# TaskDesk

TaskDesk is a self-hosted service desk and work-management platform. Staff run projects, boards and a triage queue in the agent app. Customers submit and follow requests in a separate portal. One container image serves both, and administrators configure everything else in the browser.

It is built on [Kaneo](https://github.com/usekaneo/kaneo), and the Kaneo interface is kept.

## Features

- Projects with list, board, table, backlog, calendar and timeline views, work items with sub-tasks, relations, comments and attachments.
- A customer portal with a request catalogue, request tracking, approvals, a knowledge base, announcements and release notes.
- Intake and triage, workflows, SLA policies and service calendars, approvals and change management.
- Time tracking, rates and budgets, fixed and custom reports, and a knowledge base.
- Roles from owner to viewer, teams, custom roles, and per-workspace and per-project feature flags.
- Microsoft Entra single sign-on, SCIM provisioning, two-factor authentication and an audit log.
- A REST API with an OpenAPI document, API keys, webhooks and an MCP server for AI assistants.

Most features start switched off. An instance administrator turns them on in God Mode.

## Quick start

You need Docker with Compose, `cosign`, two DNS names (one for staff, one for customers) and a Traefik proxy on the host.

```sh
cp deploy/.env.example .env
# set DOMAIN, TASKDESK_AGENT_URL and TASKDESK_PORTAL_URL
scripts/deploy.sh production
```

The script generates secrets, verifies the signed image, runs migrations and prints a one-time setup URL for the first administrator. The [install guide](docs/guide/install-and-deploy.md) covers HTTPS, upgrades, backup and restore.

## Documentation

The guides are published with GitHub Pages from the `docs` folder and live in the repository as well:

- [Install and deploy](docs/guide/install-and-deploy.md)
- [Administration](docs/guide/administration.md)
- [Agent guide](docs/guide/agent-guide.md)
- [Portal guide](docs/guide/portal-guide.md)
- [API and MCP](docs/guide/api-and-mcp.md)
- [Troubleshooting](docs/guide/troubleshooting.md)

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Release history is in [CHANGELOG.md](CHANGELOG.md).

## Licence

TaskDesk is licensed under the [GNU Affero General Public License v3.0](LICENSE). It includes code from Kaneo, which is MIT licensed. The Kaneo copyright notice and third-party licences are kept in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

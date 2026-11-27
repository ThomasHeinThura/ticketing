---
title: Administration
---

# Administration

Two levels of administration exist. Instance administrators use God Mode at `/god-mode` on the agent host. Workspace owners and admins use Settings inside the agent app. Bootstrap values live in `.env` (see [Install and deploy](install-and-deploy.md)). Everything below is stored in the database.

## First owner

On an empty database the application serves a sign-up page that only works with a one-time setup token. The token appears in the container log as a setup URL, lasts one hour or one use, and a restart issues a new one:

```sh
docker compose logs taskdesk | grep -i setup
```

Open the URL and create the account. That account becomes the instance administrator. Headless installs can set `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` and sign up with exactly that address instead.

After the first sign-in, onboarding asks for a workspace name and an owner for it. Creating a workspace is an instance-administrator action, done in a browser session, and the owner must be an existing active staff user. Workspace creators are not added as members unless they name themselves.

## Open God Mode

Only instance administrators can open God Mode. They see a "God Mode" item in the workspace switcher menu at the top of the sidebar. Everyone else does not see it, and a non-admin who types the URL is denied. You can also go straight to `/god-mode` on the agent host. If you are not signed in, it shows its own sign-in page, which takes a password and a TOTP code if you enrolled one. It uses the same session as normal sign-in.

Opening God Mode needs no extra verification. Sensitive actions inside it, such as saving sign-in settings, approving a user deactivation or running an import above 50 records, ask for fresh verification first.

Owning a workspace does not make you an instance administrator. An existing instance administrator grants it under God Mode, Users. If no administrator can sign in, run this on the server, which needs access to the container. It is audited and takes no session:

```sh
docker compose exec taskdesk node /app/apps/api/dist/cli.js grant-instance-admin <email>
```

## Instance settings

God Mode has one page for each area:

| Page | What it controls |
| --- | --- |
| General | Time zone, notification retention, anonymous rate limits, approval expiry, clarification and reopen windows, attachment limits, invitation lifetime, MCP write limits, content security policy mode (report only or enforce) |
| Features | Instance defaults for feature flags |
| Authentication | Sign-in methods, Microsoft Entra connections, SCIM |
| Organisations | Customer organisations, their request catalogue and identity connection |
| Users | Suspend, unsuspend, sign out and deactivate accounts |
| Notifications | Email provider |
| Storage | Storage usage and the S3 draft configuration |
| Plugins, Jobs | Plugin configuration and scheduled job cadence |
| Webhooks, Deliveries | Webhook secrets and delivery history |
| API keys, MCP | Keys across the instance and MCP usage |
| Audit | Audit log with export |
| Imports | Import runs |
| Observability | Health and the local factor policy |

Destructive actions, such as deleting a project or deactivating a user, open a pending action. The requester approves it in a browser session under Account, Pending actions. Nothing is removed before that approval.

### Feature flags

Most features are off by default: cycles, modules, estimates, intake, SLA, approvals, time tracking, cost tracking, knowledge base, service catalogue, customer portal, reports, automations, timeline, calendar, pages, MCP, public boards and development links. SCIM and import are on by default. Turn features on under God Mode, Features. Workspace and project settings can override flags below the instance, except SCIM and MCP, which only exist at instance level.

## Workspaces and roles

Workspace settings sit under Settings, Workspace: general, members, teams, roles, states, labels, custom fields, workflows, SLA policies, calendars, request types, rates, time activities, webhooks, automations, canned responses, work item templates, customer invitations and a danger zone.

Built-in roles, from most to least authority:

| Role | Intent |
| --- | --- |
| `owner` | Everything, including deleting the workspace and transferring ownership. Cannot be edited. |
| `admin` | Everything except deleting the workspace or transferring ownership. |
| `manager` | Runs delivery: projects, members, policies, workflows, reports. |
| `lead` | Assigns work, triages intake and decides approvals within reach. |
| `member` | Creates and updates work, comments internally, logs time. |
| `viewer` | Read-only. |
| `customer` | Portal only, with a short fixed capability set. |

Projects also have a `project-lead` role. Owners, admins and managers reach every project in the workspace. Other staff reach the projects they belong to, directly or through a team that owns the project. You can create custom roles in Settings, Roles. You cannot create or edit a role that ranks at or above your own highest rank.

Invite staff from Settings, Members. Invitations expire after the lifetime set in God Mode, General.

## Customer portal

1. Turn on `feature.customer_portal`.
2. Set `TASKDESK_PORTAL_URL` to the portal origin. The portal is recognised by its exact host and port.
3. Create a customer organisation in God Mode, Organisations, and choose which request types its customers can see.
4. Define request types and their forms in Settings, Request types.
5. Give customers access to specific projects if they should see project pages. Organisation membership alone does not grant project access.
6. Invite customers from Settings, Customer invitations, or connect an organisation-bound Entra connection.

See the [Portal guide](portal-guide.md) for what customers see.

## Sign-in

God Mode, Authentication holds a table of sign-in methods for staff and for customers: password, magic link and email one-time code. Staff password sign-in cannot be turned off, because it is the recovery path. A separate switch controls staff self-registration without an invitation. Saving needs fresh verification and applies to both portals at once.

### Microsoft Entra SSO

Add an Entra connection in God Mode, Authentication. You enter the tenant ID, application (client) ID and client secret, the OIDC scopes, and the email domains. Choose the staff portal, or the customer portal for one organisation. The connection is created disabled. The editor shows the issuer and the redirect URI to register in Entra. Enable it when the configuration is healthy.

Just-in-time access creates accounts at first sign-in with a default role and an optional required Entra app role. Group mappings turn Entra group claims into roles. Email domains are stored for discovery and collision checks, and typed-domain routing at sign-in is not active.

### SCIM

Each connection has SCIM settings. The base URL is the agent origin plus `/scim/v2`. TaskDesk returns the bearer token once, and you can rotate or revoke it. SCIM provisions users and groups and maps groups to roles. Deactivation removes memberships and revokes sessions and personal API keys. Feature flag `feature.scim` is on by default.

### Two-factor authentication

Users enrol a TOTP app and receive backup codes under Account, Security. Administrators set the requirement under God Mode, Observability, Local factor policy: off, optional, required for staff, required for one role, or required for everyone. Upstream MFA claimed by an identity provider is not accepted as proof for this policy.

### Session lifetime and sign-in throttling

The same Local factor policy card sets the staff session maximum lifetime, 1 to 90 days (default 30). A staff session older than that is signed out even if it is still in use. Customer portal sessions are not affected.

Sign-in attempts are also limited per account, on top of the per-address limit: 10 attempts in 15 minutes for one email (or, for TOTP and backup codes, one account) from one address, and 100 in 15 minutes from all addresses together. Once a limit is reached, further attempts get HTTP 429 until the window passes. The limits hold across replicas. Password hashes use argon2id. Older bcrypt hashes still sign in and are upgraded at the next successful sign-in.

## Deleted comments

Deleting a comment removes its text from the comment history and from the work item's audit entries. When a legal hold applies, the text is kept until the hold is released. Audit rows written before this change keep their text.

## Email

God Mode, Notifications sets the email provider: SMTP, or Amazon SES through its SMTP interface on port 587 with STARTTLS. The editor has a test action. Users also get an in-app inbox. They set their own preferences and quiet hours under Account, Notifications.

## Storage

Attachments use the filesystem volume by default. God Mode, Storage shows usage and lets you prepare and test an S3-compatible configuration, either external S3 or the bundled SeaweedFS from the Compose `s3` profile. Saving or testing that draft does not switch the active backend or move existing files. Set the maximum file size, files per work item and allowed extensions in God Mode, General.

## Import from Plane

Only instance administrators can import. Open God Mode, Imports, create a Plane source and start a run. Turn `feature.import` off to disable imports (it is on by default).

What comes in: projects (all, or one you name), work items with state, priority, labels, type, estimate and parent, cycle and module membership, relations, comments and attachments. Comments are imported as internal.

What does not come in: members and project roles. Assignees and authors are matched to existing TaskDesk users by email, and unmatched ones become placeholders. Invite staff and add project members yourself.

1. Create an API key in Plane and enter it with the workspace slug. The key is never shown again.
2. The importer reads Plane over its REST API. The Plane API address must be a public `https` URL. Plain `http` and private or internal addresses are refused. If yours is private, export from Plane and use the CSV import instead.
3. Discover, review the mapping, then run the dry run. Fix what it reports.
4. Apply. A run that writes more than 50 records needs an approval with fresh verification in the browser, bound to the dry run you reviewed.

The [technical contract](../technical/import-and-cutover.md#plane) has the full field mapping and edge cases.

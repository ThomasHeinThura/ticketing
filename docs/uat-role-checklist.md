# UAT role checklist (Technexus)

Agent host: `https://<agent-host>`. Portal host: `https://<portal-host>`.
Accounts: `~/.taskdesk/uat-credentials-technexus.json`. Sign out between roles. Tick each line; note any failure with the URL and a screenshot.

## Every agent role (owner, admin, lead, member, viewer)
- [ ] Sign in; the Projects list loads with no error banner.
- [ ] Sidebar highlights the page you are on.
- [ ] Open a project: Overview, Work items, Pages, Settings tabs render (tabs you may not see are hidden, not erroring).
- [ ] Reload a deep link (for example a work item URL): it opens the same page.
- [ ] Switch light/dark and a narrow window: no overlap or clipped text.

## Per role
| Check | Owner | Admin | Lead | Member | Viewer |
| --- | --- | --- | --- | --- | --- |
| Create project | yes | yes | no | no | no |
| Project Settings and Members open (no 403) | yes | yes | yes | roster readable (mutation controls absent) | roster readable (mutation controls absent) |
| Create / edit work item | yes | yes | yes | yes | no (read only) |
| Documents: add and edit | yes | yes | yes | yes | read only |
| Pages (staff only, shows warning) | yes | yes | yes | yes | read only |
| Workspace Settings mutations | yes | per grant (`workspace:manage_settings`) | no | no | no |
| God Mode (`/god-mode`) | no (requires `instance:admin`) | no (requires `instance:admin`) | no | no | no |
| Delete a project (goes to Recently deleted) | yes | yes | no | no | no |

Confirm expected "no" cells show a clear denial or no control, never a blank page.

## Instance Admin / God Mode (`/god-mode`)
God Mode is an instance-level administration capability (`instance:admin`), completely independent of workspace roles (`docs/technical/permissions.md:9`). It is never granted by workspace ownership, workspace administration, or IdP claims, and operates on its own URL (`/god-mode`) with dedicated sign-in and step-up MFA.
- [ ] Non-instance accounts (including workspace owner, admin, lead, member, viewer) cannot access `/god-mode` and are denied.
- [ ] Dedicated instance admin signs in at `/god-mode`; instance-level management and audit screens load cleanly.

## Requester (agent app)
- [ ] My Requests lists only your own requests.
- [ ] Open one, add a comment; a submission download works for you and fails for another person's link.

## Portal customer (`<portal-host>`)
- [ ] Sign in; Dashboard counts match My Requests.
- [ ] Catalogue: raise a Request; it appears in My Requests.
- [ ] Open a Request, reply, attach a file, download it.
- [ ] Withdraw a Request (confirmation dialog appears and requires confirmation).
- [ ] Knowledge base, Notifications, Settings load.
- [ ] `sign-in?redirect=https://example.com` stays on the portal after sign-in.
- [ ] Portal cannot open `/agent` pages.

## Known gaps (not failures)
Portal 404 page is unbranded; Settings and God Mode lack skip links; Triage with Intake off; S3 storage cannot be tested end to end.

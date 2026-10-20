# Status

What is true for users today, and what comes next. Keep this file under 80 lines and rewrite
it instead of appending. History up to 2026-10-20 is in git:
`git show 2cb03316:docs/07-planning/status.md`.

**Updated:** 2026-10-20 · **Latest pre-release:** `v2.0.0-alpha.4`

## Where we are

| Stage | State | Reality |
| --- | --- | --- |
| P0 Foundation | 🟡 implemented | Gates, route policy, two-origin split, backup and restore, and SIT on Compose and a VM. Awaits Thomas's walkthrough. |
| P1 Core work | 🟡 implemented | Board, list, table, side pane, bulk edit, backlog, saved views and CSV export are real. Inbox and some `/agent/settings` screens are still mock. |
| P2 Service desk | 🟡 | The APIs and domain engines are real. Intake, request-type and approval UI are partial. |
| P3 Portal and identity | 🟡 | The APIs are real, and so are the portal `/catalogue` and `/submissions/$ref` pages. The rest of the portal isn't built. Real Entra not tested. |
| P4 Governance and God Mode | 🟡 | The APIs are real. God Mode authentication and SCIM UI are real; most other settings UI isn't built. |
| P5–P7 | ⬜ | Not started. |

#863's mock P2–P4 screens were **reverted** on 2026-10-20 ([decision](decision-log.md#2026-10-20--lean-process-reset-and-stage-truth)).
The SIT seed accounts it added were kept.

## Known problems on SIT

- **Portal sign-in.** `https://portal.localhost:8443/portal/sign-in` returns 404, because sign-in
  lives at `/sign-in` and the server serves only `/`, `/sign-in`, `/catalogue` and
  `/submissions/{ref}`. `/` shows "Portal unavailable".
- **Agent sign-in** lands on the legacy `/dashboard`. Only the legacy `/dashboard/*` pages have
  kaneo's sidebar; every `/agent/*` page renders without it.
- **Empty board.** A project click opens the legacy board, which reads the old `task` table.
  The seeded data is in `work_item`.
- **Duplicates.** About 15 destinations exist in both `/dashboard/*` and `/agent/*`, and the
  `/agent` copy is often the mock.
- **Mock screens.** `components/agent/p1-core-and-settings.tsx` (from #861) still backs
  Inbox and several `/agent/settings` pages with hardcoded data.
- **Thin SIT seed.** There are no request types or submissions.

## Next

The full plan, goal and batch order are in [plan.md](plan.md). One PR per batch.

## Open obligations

- `custom-fields.md`, `automations.md` and `mcp-server.md` still say ✅ (left by #863). #863
  also hid their open review findings behind extra headings. The register is restored, and
  `check:reviews` blocks editing those specs until the findings are independently
  dispositioned, so their status is corrected together with that work.
- #580: repository query ownership. The checker reports about 2.3k problems and is not wired
  into CI.
- #626: deferrals that must be cleared before `2.0.0`.
- P3: the 25 SCIM tests against a real Entra tenant.
- Carrier #791 is still unaccepted. #811 and #773 have owner questions pending.

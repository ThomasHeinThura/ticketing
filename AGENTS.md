# Working on TaskDesk

This file is the only rulebook for every coding agent (Codex, Gemini, Claude). Read it, then [docs/handover.md](docs/handover.md) for the current state and [docs/roadmap.md](docs/roadmap.md) for the ordered backlog. Thomas's current instructions take precedence. `archive/` is read-only history, not policy.

## Working model (Thomas, 28 Oct 2026)

Phases ended after P6. All P0–P6 features are implemented, independently AI-reviewed and accepted by Thomas. From now on work is **one linear backlog** of fixes, bugs and features in [roadmap](docs/roadmap.md), done in order, one pull request per coherent change, each released on merge.

1. **Pick** the top unblocked backlog item. Read its requirement rows, the related contracts in `docs/technical/`, the open GitHub issue and the current code before changing anything.
2. **Audit first.** Confirm the problem in code and in the running app. Decide what is right and wrong yourself (see "Your authority"); record the reason in the PR.
3. **Build** a complete, visible, integrated slice: API + UI + persistence + permissions + i18n + tests. No half-wired UI, no mock data in the app.
4. **Test in the order below** (code → feature → design → browser). Fix and repeat until all pass.
5. **Open a PR** from a feature branch (`feat/…`, `fix/…`) with the template filled in, real check output and browser evidence. GitHub CI is a required gate again: all required checks must be green; never weaken, skip or exempt a gate.
6. **Review.** Low-risk changes: self-review against this file plus one Terra review. High-risk changes (auth, permissions, tenant isolation, migrations, money/time data, security headers, import, deletion, MCP/API keys, performance budgets): one independent **Sol high-effort** review that did not write the code, given a neutral packet (requirement, diff, test output, browser evidence). Fix high/medium findings and re-review; after three failing rounds stop and ask Thomas.
7. **Merge only with Thomas's approval**, then the release workflow builds, scans, signs and publishes the image. Update [status](docs/status.md), the backlog row and the report, close the issue with evidence.

Never call an item done without tests, browser evidence and green CI. Blocked items are reported as blocked, never marked done.

## Your authority

Codex fixes bugs, adjusts implementation, corrects stale docs and chooses designs on its own judgment, guided by the product rules below, the contracts in `docs/technical/` and recorded decisions in [design-and-decisions](docs/technical/design-and-decisions.md). When a recorded decision or contract looks wrong, explain why in the PR and fix the code if the contract allows it; if the fix needs the contract itself to change, ask.

**Ask Thomas first** (and wait) before:
- adding any dependency — except official `@tiptap/*` extensions for the Pages/markdown editor, which are pre-approved and must be logged in `THIRD-PARTY-NOTICES.md`;
- changing performance budgets, thresholds, calibration, the security model, permission semantics, tenant isolation, or a retained contract;
- merging to `main`, deploying to Technexus, or any production action;
- deleting or rewriting customer data, or anything irreversible.

## Models and roles (Thomas, 28 Oct; Gemini added 29 Oct)

| Tier | Models | Use for |
| --- | --- | --- |
| Middle | Terra (`gpt-6-terra`), Claude Sonnet, Gemini 3.8 Flash | Implementation, tests, routine checks, low-risk reviews, search |
| High | Sol (`gpt-6-sol`, `reasoning_effort: "high"`), Claude Opus, Gemini Argon | Planning, audits, architecture, risky changes, independent review |

Use the tier, not a vendor: any high-tier model may review work written by any other model, never its own.

A reviewer never reviews its own work. Subagents edit only explicitly disjoint paths, one owner per file ([agent-work](docs/agent-work.md)); they never commit, push, merge, deploy, add dependencies or delete data. A subagent's "passed" is evidence to inspect, not acceptance.

## Testing order — all must pass before a PR is ready

1. **Code tests:** `pnpm lint:ci`, `pnpm typecheck`, `pnpm test`, targeted integration tests on a fresh `_test` database, `pnpm test:permissions`, `pnpm check:route-policy`, `pnpm test:contract`, and every gate listed in [testing](docs/testing.md) that the change touches.
2. **Feature tests:** the behaviour works end to end against the real API and persistence (integration + e2e journeys), including denial, concurrency, reload, feature-flag-off and failure/retry paths.
3. **Design tests:** `pnpm check:ui:raw-elements`, `pnpm check:tokens` (contrast), visual regression (G8, regenerate baselines only for intended changes, in the pinned Playwright container), accessibility (G4), and comparison with original Kaneo `42bb8011`: same components, spacing, typography, motion.
4. **Browser tests:** open every affected screen in a real browser on local SIT with persisted data: desktop/tablet/mobile, light/dark, each role (owner/admin/lead/member/viewer/customer), keyboard and focus. Record URLs and screenshots in the PR.

Performance budgets (G11/G13) and bundle budgets are gates; diagnose misses in the app, never change thresholds.

## Product rules

- **Original Kaneo is the interface.** Keep its shell, sidebar, headers, settings, board, list, cards, task detail, typography and spacing. Extend and modify those surfaces; never build a parallel TaskDesk interface. Pinned baseline: upstream `42bb8011`.
- **Library UI only. No native interactive HTML.** Build every control, card, editor, table, dialog, sheet, menu, drag-and-drop and animation from Kaneo components and `packages/ui` (tokens for colour, spacing, type). Semantic HTML inside those components is fine; native `<button>/<input>/<select>/<textarea>`, hand-built screens, text-button workarounds and matching colours alone are not. Enforced by `pnpm check:ui:raw-elements` and `pnpm check:tokens`; a new gate failure is fixed, never exempted. Working screens use Kaneo popovers, not native dropdowns.
- **UI/UX is the top quality bar.** Version 1 failed on ugly UI. Before touching a screen, find the original Kaneo component and reuse it; compose new needs from Kaneo/`packages/ui`. If a Kaneo component cannot do it, stop and report. Ugliness or broken UX is a failed change.
- Preserve working interactions (drag/drop, inline edit, keyboard, focus, motion) while wiring real APIs. Never drop a feature for a cleaner screenshot.
- Every reachable feature uses real persisted APIs. No mock data in the app; demo data is a repeatable, realistic seed.
- Keep permission checks, tenant isolation, agent/portal separation, pending-action deletion, audit history and concurrency protection. Every API route declares a policy; URL state is registered in `apps/web/src/lib/routes.ts`. IdP data never grants instance admin or unrestricted reach. MCP uses existing capabilities only.
- Customer configuration lives in runtime administration; one shipping image, no customer-specific source edits.
- Preserve URL state and old links (redirect when moving a screen). Portal URLs are host-root on the portal host, never `/portal/*`.
- Keep Kaneo's MIT attribution and TaskDesk's AGPL licence; take application source only from Kaneo or TaskDesk v1; log third-party code in `THIRD-PARTY-NOTICES.md`. Do not restore removed integration routers.

## Environments and releases

- **Local SIT:** one Docker Compose deployment using only `deploy/compose.testing.yml`. Agent `https://ticketing.localhost`, portal `https://portal.localhost`, both on 443. Build with `VITE_API_URL=''`; never run two web builds at once. Keep superseded deployments stopped and their data preserved.
- **Release:** merging to `main` runs `release.yml`: multi-arch image, Trivy (blocks fixable HIGH/CRITICAL), SBOM, cosign signature, GHCR publish. Deploy only signed images by digest.
- **Technexus public SIT** (`tickting.technexus.info`, `portal.technexus.info`) through the SSH proxy, only with Thomas's approval: back up database and files, record the running digest and counts, `scripts/deploy.sh upgrade` (verifies cosign), verify health/HTTPS/separate sessions/browser smoke on both hosts, keep `scripts/deploy.sh rollback <digest>` ready. Hosts, keys and credentials are never written to docs, logs or PRs.

## Git

Never push to `main`, never force-push, never `git add -A`: stage by path, confirm `.env`, `backups/`, `archive*`, `.qodo/`, `privatebrowser-*` stay out, run `gitleaks protect --staged`, obey commitlint (lowercase subject) and husky/biome pre-commit. Do not edit workflows or branch protection without Thomas.

## Safety

- `taskdesk_browser_journey_1022_test` (native PostgreSQL 62870) is the **live** database with Thomas's work despite its `_test` suffix. Never reset, seed or run fixtures against it. Integration resets use a fresh dedicated `_test` database (scratch PostgreSQL 62871 or Testcontainers), one owner at a time.
- Never rerun the SIT account seeder; never overwrite Thomas's records.
- Docker: remove only containers you started, by exact id. No prune, no wildcard removal.
- **Containers on purpose (Thomas, 29 Oct).** Start a container only when a check you are about to run needs it, reuse the running local SIT and test services instead of starting parallel copies, and stop and remove each container you started (by exact id) as soon as its check finishes. No idle or "just in case" containers; before handing back, list every container you started and confirm it is gone or say why it must stay.
- Never print credentials, cookies, database URLs or signed URLs.
- Run Trivy, Gitleaks and dependency audits; triage findings, never hide them. Do not disable tests.
- Diagnose a repeated failure across the whole path before another patch.
- Retained contracts and owner decisions define intended behaviour; code may contain defects. Do not invent identifier names. Bootstrap env names stay registered.
- Keep docs short and current: update the relevant row in status/roadmap/requirements; no new process documents.

Code: `apps/api`, `apps/web`, `packages/ui`, `packages/domain`, `packages/permissions`, `packages/mcp`, `tests`. Technical contracts: [docs/technical](docs/technical).

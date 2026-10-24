# Handover for the next Claude coding agent (24 October 2026)

This file is overwritten per handover and records state only. Rules live in [AGENTS.md](../AGENTS.md); evidence in [status](status.md), [roadmap](roadmap.md), [requirements](requirements.md) and [contracts](contracts.md). Original Kaneo at `42bb8011` is the UI baseline: reuse Kaneo and `packages/ui`, keep drag/drop, editors, menus, motion and keyboard behavior, keep persisted APIs, permissions, tenant/portal separation, concurrency, pending deletion and history.

## State

- Workspace `/Users/heinthura/Documents/Workfolder/Development/Ticketing.v2`, branch `feat/batch1-hierarchy-and-parent-editing`.
- Last pushed commit `1de552577` (P4 review record) on top of P4 `c02a0892b`. P0–P3 are committed and pushed earlier.
- **P5 is built but uncommitted** in the working tree (large dirty tree, intentional). Opus rounds 1–4 failed with all mediums fixed; round 5 is running. Preserve all uncommitted work: no reset, clean, stash, second checkout, force push or direct main push. Commit only after the P5 review passes.
- Nothing from P4 or P5 is browser-verified. P0–P5 are half finished; open items are the carry lists in [report data](report/data.json).

## How work is run

One coordinator, one shared worktree. Bounded Sonnet 5.5 lane agents own disjoint paths (see [agent-work.md](agent-work.md)); they never commit, push, deploy, add dependencies or delete data. The reviewer is a fresh Opus 5.5 high-effort agent given a neutral packet (requirements, diff, test output). The implementer never reviews its own phase. Up to three rounds per phase are approved by Thomas; extra P4 and P5 rounds were approved separately.

**Scratch database method.** Test runs use scratch Postgres 62871, never the native 62870. Copy the env wrapper for the lane, point the copy at a new database for each agent, create it fresh (edited-in-place migrations require this: a reused database keeps old foreign-key rules), and drop it at the end. Inspect a wrapper before use.

**Generators are coordinator-only:** `openapi:write`, the matrix `REGEN_MATRIX`, `generate:route-metadata`, and any `vite build` (it regenerates route trees). Do not run two web builds at once. The drizzle snapshot comes from a scratch pty run. Migrations are edited in place only before their first real apply; after that, add a new one. Build web with `VITE_API_URL=''` for both entries.

## Safety that matters

- **`taskdesk_browser_journey_1022_test` is the LIVE database** with Thomas's work, despite the suffix. It is on native Postgres 62870, backup taken 24 Oct, 130 migrations applied, **no P4 or P5 migrations applied**. `env-wrapper.py app|owner|migrate` targets it: never run resetting fixtures through it. Migrate only after P5 passes, dry run on a restored copy first, with Thomas's explicit go; check `__drizzle_migrations` order and `local_factor_policy` first.
- Never rerun the SIT account seeder (it changes fixed accounts and sessions). Never overwrite Thomas's moved or created records (HELP-12 and others).
- Docker: remove only your own containers by exact id. No prune, no wildcard removal.
- Never print credentials, cookies, database URLs or signed URLs. Private runtime and provenance files stay under `/tmp/taskdesk-local-runtime-*/`; read locally only when needed.
- Archive decision stands: keep `archive/` ignored and read-only; maintained docs have no operative archive pointers.
- Scripted sign-in is blocked by the permission classifier. Do not bypass it; ask Thomas to sign in for browser verification. Chrome file selection is also blocked, so do not claim upload-control acceptance.

## Checks and known failures

[testing](testing.md) lists gates and baseline failures: `check:tokens` fails at HEAD on `packages/ui` pairs.json, three ci-script tests are stale, and port-bound MFA fixture tests fail while a local stack holds the ports. Full integration on the final P5 tree was still running at handover; do not cite old counts.

## Resume

1. Collect Opus round 5 and the full integration result for P5; fix, re-verify, then commit and push by path (Gitleaks on staged files).
2. Get Thomas to sign in, then browser-verify P4 and P5 against [screen-test-cases](screen-test-cases.md).
3. Settle P5 gaps (cost entries, available hours, typed-domain SSO) and P4 carries, then plan the live-DB migration.
4. Start P6 only after P5 passes. Real Entra, penetration test and a signed digest-pinned image stay externally blocked.

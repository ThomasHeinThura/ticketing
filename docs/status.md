# Current status — 24 October 2026

Nothing below is Thomas-accepted. "Reviewed" means an Opus 5.5 code review plus tests; **nothing from P4 or P5 is browser-verified** (scripted sign-in is blocked by the permission classifier, so Thomas must sign in). P0–P5 are only half finished: partials, missing items and external blockers remain per phase. Counts and carries are in [report data](report/data.json) and `docs/report/audit/audit-P*.json`. Branch `feat/batch1-hierarchy-and-parent-editing`, last pushed commit `1de552577`.

## Phases

| Phase | Git state | Opus review | Implemented and tested | Partial or missing | Browser |
| --- | --- | --- | --- | --- | --- |
| P0 Foundation | Committed, pushed | 4 rounds, pass with conditions | 12 of 21 | 6 partial, 3 externally blocked | Not verified |
| P1 Core work | Committed, pushed | 2 rounds, pass with conditions | 140 of 181 | 28 partial, 8 missing, 5 blocked | Board, sheet, calendar, members, templates, states, approval dialog checked earlier |
| P2 Service desk | Committed, pushed | 2 rounds, pass with conditions | 117 of 137 | 15 partial, 5 blocked | Not verified |
| P3 Portal and identity | Committed, pushed | 1 round, pass with conditions | 34 of 53 | 9 partial, 10 blocked (real Entra) | Not verified |
| P4 Governance | `c02a0892b`, pushed | 5 rounds, round 5 pass | 112 of 152 (5 untested) | 30 partial, 4 missing, 1 blocked | None: step-up flows need Thomas to sign in |
| P5 Planning, insight, knowledge | `95ba4061d`, pushed | Rounds 1-7 found mediums (all fixed); round 8 pass (no high/medium) | 62 of 91 (3 untested) | 22 partial, 4 missing | None |

P5 not built: cost entries (TC-12/13/14) and so budget actuals are time-only, available hours (TC-20), typed-domain SSO (CP-17/18/27-29, IP-9/29). P5 also has partial reports (no snapshots, drill-down on 12 reports), KB editor gaps, CAB opt-in only, no customer release page. The full carry lists are the `carry` fields for P4 and P5 in data.json.

## Gates

- **P4 (committed):** full integration 314 files / 4241 tests, API unit 1656, permissions 115, packages/permissions 277. Failing: `check:tokens`/contrast (also fails at HEAD) and 3 stale ci-script tests. Not run: browser, Trivy.
- **P5 (final tree):** API unit 1863, web unit 2651, permissions 115, typechecks clean, `check:policy`, `check:events`, `check:ui:raw-elements`, inventory, env, i18n and drizzle drift pass. Lane integration suites pass. Full integration on the final tree: 5011 of 5011 tests passed (fresh scratch DB; two harmless file-level noises). Same two known failures; Trivy and browser not run.
- Port-bound MFA fixture tests fail while a local stack holds the ports. Details in [testing](testing.md).

## Environments

- **Local SIT first.** Agent `http://localhost:1337`, portal `http://portal.localhost:1337`. Technexus public SIT follows only after local passes.
- **Scratch Postgres 62871** for every test run, with a fresh database per run (edited-in-place migrations need it).
- **Native Postgres 62870** holds Thomas's live database `taskdesk_browser_journey_1022_test`: backup taken 24 Oct, 130 migrations applied, **no P4 or P5 migrations applied yet**. The running local build predates P4 and P5. Migrate only after P5 passes, dry run on a restored copy first, and only with Thomas's explicit go. Check `__drizzle_migrations` order and `local_factor_policy` first (P4 carry).
- Never rerun the SIT account seeder. Preserve Thomas's records (HELP-12).

## Next actions

1. Fix the open round-6 findings (satisfaction report double count; time-tracking nav for viewers; lows), build the agreed carries (cost entries and available hours, P4 carries, reports gaps), then Opus rounds until no high/medium (up to 8).
2. Thomas signs in so P4 and P5 screens can be browser-verified ([cases](screen-test-cases.md)); until then screens stay marked built, not verified.
3. Decide the open P5 items: build cost entries and available hours, or record deferrals; typed-domain SSO needs a contract.
4. Dry-run migrations on a restored copy of the live backup, then migrate the live database with Thomas's go.
5. Close P4 carries (migration journal order 0147 before 0145, missing 0158 snapshot, `automation:manage` enforcement), fix `check:tokens` on `packages/ui` pairs.json, then start P6.

Externally blocked, never marked done: real Entra tenant, external penetration test, signed digest-pinned image. Older handover detail is in [handover](handover.md).

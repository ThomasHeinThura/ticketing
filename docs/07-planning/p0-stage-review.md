# P0 stage review

Written stage review for P0 · Foundation, as the
[Definition of Done](../04-engineering/definition-of-done.md#stage-completion) requires. It
includes what went wrong. Date: 2026-10-10.

This is a record, not an approval. It cites its evidence. Where evidence does not exist, it
says so. Private evidence paths are under `~/.codex/taskdesk-evidence/2026-10-10/` on the
conductor's host.

## What this claim binds to

The P0 claim binds to:

- release `v2.0.0-alpha.3`, source `b704f707` (#621), and
- the installer fix #623, `f4f6b011`, which changes `install.sh` only (plus its docs and
  tests). It does not change the image, `deploy.sh` or the Compose files.

It does **not** bind to later `main`. After #622 (`954eb840`, the S1 identity slice), `main`
has moved past the P0 two-entry host matrix in [phases.md](phases.md#p0-two-entry-host-and-static-acceptance).
The portal host now admits customer session and identity routes on purpose. No image boot or
installer evidence exists for `954eb840` or later (finalizer N9). Anything merged after
#623 is outside this claim.

## What P0 delivered

P0 goal: a working, de-branded, quality-gated skeleton. See [phases.md](phases.md#p0--foundation).

Merged on 2026-10-10 (all squash merges, each pinned to its reviewed head):

| PR | Change | Merge commit |
| --- | --- | --- |
| #602 | P0 closure source, task strict/rollback proof, calibrated G11 speed gate | `b64f8062` |
| #615 | Policy restructure | `26c43def` |
| #616 | Model-aware PR-template check, `check:policy` | `1fc04d05` |
| #617 | `deploy.sh` padded-digest parse, fail closed | `511c917f` |
| #618 | Migration spine 0088 to 0118 (M1) | `6568fc3e` |
| #619 | Storage URLs from the configured public origin (rebuild of #599) | `d743ae32` |
| #620 | Migration 0119, tenant-composite FKs | `24a48912` |
| #621 | Deploy and installer whole-path fix (port publication, image digests) | `b704f707` |
| #622 | S1 identity slice (post-P0; outside the claim) | `954eb840` |
| #623 | Installer re-run fix, docs corrections | `f4f6b011` |

Earlier P0 work (the CI gate matrix, policy registry, Docker image, deploy skeleton,
seed profiles, RLS prototype, shared UI foundation, and the router retrofit in #579) merged
before 2026-10-10 and is covered by `status.md` and the pull-request list, not repeated here.

Releases (signed GHCR prereleases, `gh release view`):

| Tag | Source | Published (UTC) |
| --- | --- | --- |
| `v2.0.0-alpha.1` | `b64f8062` (#602) | 2026-10-10 02:39 |
| `v2.0.0-alpha.2` | `511c917f` (#617) | 2026-10-10 04:44 |
| `v2.0.0-alpha.3` | `b704f707` (#621) | 2026-10-10 09:06 |

Installer proof on `alpha.3` passed in a disposable VM: `p0-installer-proof-3-20261010T090655Z`
(`result.json`: PASS with findings). A targeted re-proof after #623 passed cases 1 to 3:
`p0-installer-proof-4-20261010T115535Z`.

## Exit-criteria table

Rows 1 to 25 are the P0 phase finalizer's table (Claude Opus 5.5, reviewed head `954eb840`,
verdict NOT COMPLETE at that time). "Status now" updates each row after #623, the targeted
re-proof and the 2026-10-10 decisions recorded by PR #624.

The **waiver** below means Thomas's 2026-10-10 deferral in PR #624's decision-log entries
"P0 stage-gate activities deferred to before `2.0.0`". It covers PG2 to PG6, P0 screen
sign-off (row 15, ✅ in the screen inventory; Thomas: "Yes, defer row 15 too."), the k6
baseline, the 10k-row data test, full and reduced-motion E2E, and backup restore. Each runs
once over the whole surface before `2.0.0`. It is a deferral, not a pass.

| # | Criterion | Status now | Evidence |
| --- | --- | --- | --- |
| 1 | Stack builds and deploys on three hostnames | Met, with caveat | `alpha.3` proof F1, U1 to U5. The files host resolved only through a hosts entry (FND-1, fixed by #623). OrbStack hostnames in `status.md` 2026-10-05 |
| 2 | Every CI gate green; inherited routes carry policies | Met for #615 to #623. #602 was merged through a lifted check | Lift recorded and waived in the decision log by #624 (finalizer B3) |
| 3 | P0 Sol review signs off the router retrofit | Met by record, not re-performed | `security-reviews/579-p0-*-sol-security.md`; `602-p0-scope-clean.md` |
| 4 | Anonymous sign-in off, account linking off, cookie cache off | Met | `apps/api/src/auth.ts` (accountLinking, `anonymous()` removed, `cookieCache.enabled: false`) |
| 5 | No route for public-project, github, gitea, slack, discord, telegram, generic-webhook | Met | No such route in `apps/api/src`; negative tests in `tests/api-integration/authorization-boundaries.test.ts`, `workspace-rbac.test.ts` |
| 6 | No `process.env` read outside the approved list | Met (CI) | Required check `check:env` green at each head |
| 7 | kaneo baseline recorded | Met | `docs/01-architecture/inherited-features.md` |
| 8 | PR template present | Met | `.github/pull_request_template.md` |
| 9 | RLS prototype merged with findings | Met | [rls-prototype-results.md](rls-prototype-results.md) |
| 10 | Two-entry host and static matrix; image boots both roots; hostless probes | Met at `b704f707`; superseded on `main` by #622 | Proof 3 U5 (ready 200, live 200). See "What this claim binds to" |
| 11 | Three issue-free UTC dates of policy-shadow evidence | Not a P0 exit criterion (Thomas, 2026-10-10: "Not part of P0") | The three-date rule gates activation of a strict policy source (decision log 2026-10-04, `TASKDESK_POLICY_ENFORCE`), not stage exit. The P0 claim activates no persistent strict source; enforcement stays off by default. Evidence so far is adjudicated for 9 behaviours (`p0-oct9-runtime-adjudication.md`) and 12 task reads (`task-source-date-compatibility-sol.md`), not all 27 sources. Each source still needs three issue-free UTC dates before activation |
| 12 | Signed-main release installer upgrade and rollback | Met | Proof 3 (alpha.3 upgrade, re-run, rollback PASS). FND-1 fixed by #623 and re-proven in proof 4 cases 1 to 3. Case 4 (alpha.2 to alpha.3 installer-to-installer) was **not possible by design**: alpha.2's `deploy.sh` port-check defect was fixed in #621, so an alpha.2 fresh install cannot complete. Not evidenced; see below |
| 13 | Every feature meets its Definition of Done | Per-PR records only | Not independently re-established at stage level |
| 14 | PG1 screen review | Deferred (allowed) | DoD stage list; decision log 2026-10-02: human design sign-off at the P4 review |
| 15 | Every P0 screen ✅ in the screen inventory | **Not met.** Deferred under the widened waiver (Thomas, 2026-10-10) | No row marked ✅. [screen-inventory.md](../02-design/screen-inventory.md) note, 2026-10-10. Runs in the once-before-`2.0.0` pass |
| 16 | Full E2E suite green, agent and portal, plus reduced motion | **No evidence recorded.** Deferred (#626) | Waiver. Only the `e2e - protected-route redirect` required check ran |
| 17 | PG2 screen reader, PG3 keyboard, PG4 fresh-eyes, PG5 cross-browser | **No evidence recorded.** Deferred (#626) | Waiver (confirms the 2026-09-05 waiver, widened to PG3) |
| 18 | PG6 realistic data (10,000 items, 50 projects, 200 people) | **No evidence recorded.** Deferred (#626) | Waiver |
| 19 | Load-test baseline recorded | **No evidence recorded.** Deferred (#626) | Waiver (k6) |
| 20 | Backup and restore verified | **Not met.** Deferred | Waiver. Proof 3 F2 took a `pg_dump`; no restore was run |
| 21 | Phase finalizer | Re-check done: conditional | First pass NOT COMPLETE at `954eb840`; re-check P0 COMPLETE CONDITIONAL ON. See "Phase finalizer" below |
| 22 | Written stage review, including what went wrong | This document | |
| 23 | Screen inventory, feature index and CHANGELOG updated together | Partly done | CHANGELOG and screen inventory updated with this review. The feature-index status columns ([03-features/README.md](../03-features/README.md)) need no change: P0 claims no feature at its Definition of Done, so no status moves |
| 24 | Roadmap and status updated | `status.md` refreshed in #624; `roadmap.md` does not change | `roadmap.md` holds the stage sequence and what each stage makes possible, with no per-stage status column or dated status, so there is nothing to update for a P0 claim. The dated snapshot is in [status.md](status.md) |
| 25 | Gates table complete; every waived row linked to the decision log | Met after #624 | #602's merge-time waiver is recorded in the decision log by #624. #602's PR body is not edited |

## What went wrong

These are the failures, in plain terms.

1. **A real defect (FND-1) survived two installer proofs.** The first install wrote
   `TASKDESK_FILES_HOST=files.<domain>` into `.env`. The next run of `install.sh` then
   checked that name in DNS and failed. It was caught only in proof 3, and only because a
   hosts entry had to be added to get past it. Proofs 1 and 2 never reached a re-run, and
   no proof started from an installer-written `.env`. Proof 3 was also a "hybrid": it
   started from the signed edge image with `alpha.3`'s `deploy.sh`, not from an earlier
   release installed by the installer (finalizer N10). Fixed by #623.
2. **Two earlier installer proofs failed outright.**
   - Proof 1, on `alpha.1`: `deploy.sh` read the padded `Digest:` line from newer
     `docker buildx` wrongly and aborted. Fixed in #617, released as `alpha.2`.
   - Proof 2, on `alpha.2`: `docker compose port` printed `:0` for an exposed but
     unpublished port, and `deploy.sh` treated that as published. Fixed in #621, released
     as `alpha.3`. Proof 4 showed the same `:0` behaviour on Ubuntu's Compose 2.40.3, not
     only Compose v5.6.0.
   - Evidence: `p0-installer-proof-20261010T024034Z`, `p0-installer-proof-2-20261010T044523Z`.
3. **#602 merged through a lifted required check, recorded only afterwards (B3).**
   Thomas approved a one-time removal of `pull request template + security review` from
   the ruleset. The ruleset history shows it removed at 02:13:05 UTC, #602 merged at
   02:13:44 UTC, and the check restored at 02:15:37 UTC. No decision-log entry existed
   until #624. The 2026-10-09 "Model tiers by availability" entry even said an earlier lift
   was withdrawn and the ruleset was not changed. #602's own `## Gates` table said no gate
   was waived. Both claims were wrong at merge time. The underlying review itself was not
   in doubt, only the label match.
4. **Docker Hub HTTP 500 needed a second re-run.** Integration and e2e failed twice on a
   pre-test infrastructure error. Policy allows one re-run per incident. Thomas authorized
   a second on 2026-10-10 at 01:28 UTC. That authorization was also unrecorded until #624.
5. **The G11 runner-class variance forced a method change.** The speed gate gave different
   results on fast and slow GitHub runner CPUs. The fix was runner calibration (raw
   timing divided by a measured speed factor, clamped), accepted by Thomas on
   2026-10-10 and merged in #602. This hides a regression up to that factor on slow
   runners (finalizer N7).
6. **A review rebind was mis-extracted, then corrected append-only.** In
   `security-reviews/m0119-tenant-fks.md`, the conductor copied only a trailing
   `## Not re-run` fragment instead of the reviewer's rebind section. The note says so,
   leaves the bad section in place, and appends the complete section. The first report
   header also carried a placeholder context ID that the reviewer corrected.
7. **`status.md` went stale for five days (B4).** Its newest snapshot was 2026-10-05 and
   still named `8ddb9de8` as `main`. It did not mention #602 to #622, the three
   prereleases or the installer proof. Refreshed by #624. The queue file that
   `active-mission.md` names (`integration-execution-queue.md`) is not on `main` yet
   (finalizer N11).
8. **Some reviews fell below the review-count table with no recorded reason (N4).** #621
   changed a security control's core logic and had one ordinary review; the security
   review then found a real fail-open in the TRUST_PROXY guard that the ordinary review
   missed. #619 and the #602 calibration delta also had one ordinary review each.
9. **The first finalizer verdict was NOT COMPLETE.** The finalizer found four blocking
   items (B1 installer, B2 stage-gate evidence, B3 unrecorded lift, B4 stale records).
   This review exists because of that.

## Process changes already made

- Decision-log entries for the #602 lift, the second re-run and the stage-gate deferral,
  with a waiver row, were written by #624.
- #616 made the PR-template check model-aware. Labels are matched exactly against the
  allowed-model block read from the merge base, and a reviewed head must be an ancestor
  with no non-note commits after it.
- #623 added non-vacuous installer tests for the re-run and the S3 and explicit-host cases.
  The new re-run test was shown to fail against the old `install.sh`.
- Review reports are inserted verbatim with a SHA-256 marker. The finalizer recomputed 39
  report hashes across eight notes; all matched. The m0119 mis-extraction was corrected in
  the same way, append-only.
- `status.md` was refreshed (#624). The P0 claim is now bound by SHA to a release, so later
  `main` cannot silently change what was accepted.

## Residual non-blocking items

From the finalizer report. Owners are the next stage or the conductor, since none blocks
the P0 claim. Items N1 and N2 are closed by #623 and are not listed.

| Item | What | Owner |
| --- | --- | --- |
| N3 | Rollback past the immediately previous release is unsupported in principle. The 0093 unique index and 0081 check mean an old image writing a duplicate membership gets a 5xx. Old-image writes were not tested. Name the previous release as the supported target in the runbook; consider a schema-ahead warning | Next stage (P1 migrations / runbook), conductor |
| N5 | A manual release can name any commit reachable from `main`, including unreviewed merge-era commits. It cannot release an unmerged SHA. Require `source_sha` to be on the first-parent history | Next stage, CI/CD owner |
| N6 | The template check trusts a self-declared model label and a typed reviewed-head SHA. Real control is verbatim hashed transport, checkable only by the conductor | Conductor; sampled audits |
| N7 | G11 calibration can mask a regression up to its factor on slow runners, or if a regression inflates the factor. Alert when the factor is above about 1.2 on a CPU that was recorded at 1.0 or below; re-record R0 if the runner pool changes | Next stage, performance owner |
| N8 | After #622 the portal host admits mutating customer auth endpoints that skip TaskDesk's double-submit CSRF check (it applies only when the agent session cookie is present). Not exploitable today; becomes a gap with the first mutating `kind: "portal"` policy route | P3 identity lane |
| N10 | No real installer-to-installer upgrade has been proven. Proof 4 case 4 (alpha.2 to alpha.3) was not possible by design. A future pair of releases must be used once one exists with an installer-written `.env` | Next release, conductor |
| N11 | `integration-execution-queue.md` named by `active-mission.md` is not on `main` (it is on #601's branch until that merges) | Conductor |
| N12 | The tamper proof (U7) tests `sha256sum` and `cosign verify-blob`, not `install.sh` end to end. Unit tests cover the installer's rejection before any write | Next stage, installer tests |

Also open and not a finalizer N-item: N4 (record a tier rationale in each review note) and
row 11 (policy-shadow dates shown for 9 behaviours and 12 task reads, not all 27 sources). Thomas ruled row 11 is not part of P0; it gates later activation of each strict policy source.

Finalizer re-check notes, non-blocking: the `github-advanced-security` check was `failure` at the heads of #623 and #624 (a Copilot-agent run with a runtime-download retry failure). It is not a required context. "All checks green" is therefore not claimed literally.

## Not evidenced

- Proof 4 case 4 (installer-to-installer from `alpha.2`).
- Any screen-reader, keyboard-only, fresh-eyes, cross-browser, realistic-data, k6 or
  restore result. All are deferred before `2.0.0` under the waiver.
- Image boot or installer evidence for any commit after `f4f6b011`.
- A cryptographic cosign verification by the finalizer. Cosign was not installed in its
  context. Proofs 3 and 4 ran cosign v3.0.5 inside the VM.

## Phase finalizer

- **First pass:** Claude Opus 5.5, reviewed head `954eb840`, 2026-10-10. Verdict: P0 NOT COMPLETE (blockers B1 to B4).
- **Re-check:** Claude Opus 5.5, 2026-10-10, reviewed heads `f4f6b011` (main), `f7aa71ac` (#624) and `48e07b8e` (this branch before the merge). Verdict: **P0 COMPLETE CONDITIONAL ON** merging #624 and this branch with the listed corrections (a second ordinary review of #624; a refreshed status snapshot; row 15 named in the waiver; the CHANGELOG and stage-review corrections; the roadmap line). This branch carries those corrections.
- **Record:** the finalizer report and re-check are committed unmodified, with their SHA-256, in [p0-phase-finalizer-record.md](p0-phase-finalizer-record.md). The conductor verifies the merged content against the conditions before claiming P0.
- **Status:** P0 is **not** claimed unconditionally. The conductor changes this line after merge verification.

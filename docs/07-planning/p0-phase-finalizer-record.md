# P0 phase finalizer — record

The P0 phase finalizer is a fresh, independent Claude Opus 5.5 (`claude-opus-5-5`) context, `afbb497ede0233485`. It is Sol-tier under Thomas's routing and is not a GPT-6 Sol review. Its report is inserted unmodified, with its SHA-256.

- **First pass:** P0 NOT COMPLETE.
- **Re-check (2026-10-10):** P0 COMPLETE CONDITIONAL ON this pull request's corrections.

The conductor verifies the landed commits against those conditions before claiming P0.

This file is kept outside `security-reviews/` on purpose. It is a stage record, not a per-PR review binding.

<!-- BEGIN REPORT (agent afbb497ede0233485; model claude-opus-5-5; role P0 phase finalizer (first pass and re-check); candidate 954eb84094e009658943af1e294d3b8a48d17f69; re-check f4f6b011, f7aa71ac, 48e07b8e; sha256 95a7bed41c39674a80022f945f15a870f688ef1f3c45fb37455667b10bddc9d8) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:p0-phase-finalizer (this context cannot see its own subagent id; it was spawned by session 3a9e9ce4-8409-47d4-b1be-1f1544697e70)
**Reviewed head:** 954eb84094e009658943af1e294d3b8a48d17f69

# Verdict: P0 NOT COMPLETE

P0 cannot be claimed today. There are four BLOCKING findings (B1–B4):

- B1: the installer re-run DNS defect is not merged.
- B2: most items in the Definition of Done stage-completion list have no evidence, or rest on a waiver that is still pending with Thomas.
- B3: #602 merged with a failing required check, and that bypass has no decision-log record.
- B4: `status.md` and the other stage-close records are stale.

The code and supply-chain work merged on 2026-10-10 is sound. I found no exploitable cross-PR defect in it. The gaps are installer correctness (B1), stage-gate evidence (B2) and records (B3, B4).

**Independence disclosure.** This is a fresh context. It did not author, direct, remediate, orchestrate or merge any P0 PR. However, it was spawned by the conductor session (3a9e9ce4…), which orchestrated and merged #617–#622. Reviewer contexts recorded in m0119-tenant-fks.md and s1-identity.md are also subagents of that same session. If Thomas requires the finalizer to come from a session other than the conductor's, this report is advisory. A finalizer launched outside that session would then be needed.

**Previous finalizer.** None exists. No phase-finalizer note is in `docs/07-planning/security-reviews/`. `status.md` lists "additional independent Sol phase finalizer" as open in every snapshot through 2026-10-05. This pass therefore covers all of P0. It goes deepest on #602 and #615–#622.

---

## Merged scope (verified with `gh pr view` and `git`)

All nine are squash merges. Each was made from a head already based on the previous main. In every case the merge tree is byte-identical to the PR head (`git diff --quiet head merge`). In every case the last reviewed head is an ancestor of the merged head, and only review-note commits follow it.

| PR | Head | Merge commit | Last reviewed head (ancestor) | Commits after it / non-note files | Ordinary reviews | Sol-tier review |
| --- | --- | --- | --- | --- | --- | --- |
| #602 | f10ceb27 | b64f8062 | c1b9ea3b | 1 / none | 1 Sonnet context over the calibration delta. Product source has the historical GPT-6 Luna chain | Opus a4000037 (delta). Product source has the historical GPT-6 Sol chain |
| #615 | 37605b16 | 26c43def | (policy notes; template check green) | — | per 615-* notes | Opus |
| #616 | e2590c8d | 1fc04d05 | 1deb5232 | 1 / none | per 616-* notes | Opus |
| #617 | ca1d1bb1 | 511c917f | a43601f4 (rebind) | 1 / none | 1 Sonnet | Opus a0a19c5d |
| #618 | 491ed26c | 6568fc3e | 94e27d23 | 1 / none | 3 Sonnet (A, B, C) | Opus a3bc54a2 |
| #619 | 0d961e46 | d743ae32 | c05a4a32 | 1 / none | **1** Sonnet | Opus af70b84f |
| #620 | de1cdc06 | 24a48912 | 5cf3093c (rebind) | 2 / none | 2 Sonnet | Opus aecdf413 |
| #621 | 375ad06a | b704f707 | 98d7de56 | 1 / none | **1** Sonnet | Opus abbf154c |
| #622 (post-P0) | 1f05baf0 | 954eb840 | 512a6d85 | 1 / none | 3 Sonnet | Opus added0c8 |

- **Report integrity.** I recomputed the SHA-256 of all 39 `BEGIN/END REPORT` blocks in 602, deploy-digest-parse, m1, 599, m0119, deploy-whole-path-fix, s1 and 616-round7. All 39 match their markers.
- **Reviewed-head lines.** Every note named in the brief carries a `**Reviewed head:**` line.
- **Labels.** Every Opus review is labelled Claude Opus, and none is labelled GPT-6 Sol.

**Required checks at each exact head.** All required contexts are green for #615–#622. #602 is the exception: its required context `pull request template + security review` is **failure** at f10ceb27 (run 38014207174). The log shows one error only: `**Model:** must be exactly GPT-6 Sol, and it names "Claude Opus"`.

---

## Exit-criteria table

Sources:

- `docs/07-planning/phases.md` § P0 "Done when" (lines 189–197) and the P0 two-entry matrix (lines 118–151).
- `docs/04-engineering/definition-of-done.md` § Stage completion (lines 161–198).
- Decision log 2026-10-02: three issue-free UTC dates; human review deferred to P4.
- Decision log 2026-10-09 "P0 evidence boundary": a signed-main release installer upgrade and rollback, then a fresh accepted-main finalizer.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Stack builds and deploys on three hostnames | MET, with caveat | alpha.3 VM proof `result.json` F1/U1–U5. The proof used ticket., portal. and files.proof.test, but files.* resolved only through a manual hosts entry (FND-1). OrbStack ticketing.localhost and portal.localhost are recorded in status.md 2026-10-05 |
| 2 | Every CI gate green, with inherited routes carrying policies | MET for #615–#622. **Bypassed for #602** (template check failed; ruleset lifted) | Ruleset 22365005 history: v52653414 at 02:13:05Z drops `pull request template + security review` (18→17 contexts). #602 merges at 02:13:44Z. v52653571 at 02:15:37Z restores it. See B3 |
| 3 | P0 Sol review signs off the router retrofit | MET by record (not re-performed) | 579-p0-*-sol-security.md; 602-p0-scope-clean.md GPT-6 Sol chain |
| 4 | Anonymous sign-in off; account linking off; cookie cache off | MET | `apps/api/src/auth.ts:268` (accountLinking, disabled per comment), `:317` (anonymous() removed), `:439-440` (`cookieCache.enabled: false`) |
| 5 | No route for public-project, github, gitea, slack, discord, telegram or generic-webhook | MET | No such route literal in `apps/api/src`; negative tests in `tests/api-integration/authorization-boundaries.test.ts` and `workspace-rbac.test.ts`; route-coverage gate green |
| 6 | No `process.env` read outside the approved list | MET (CI) | `registers - env…` required check green at every head |
| 7 | kaneo baseline recorded | MET | `docs/01-architecture/inherited-features.md:17` |
| 8 | PR template present | MET | `.github/pull_request_template.md` |
| 9 | RLS prototype merged with findings, or dropped | MET | `docs/07-planning/rls-prototype-results.md` (recommendation, pooling, cost, agreement) |
| 10 | Two-entry host/static matrix; image boots both roots; hostless probes | MET at b704f707. **Superseded on main by #622** | U5 (ready 200, live 200). At 954eb840 the portal host admits `/api/auth/get-session`, sign-out, 2FA verify and identity start/callback (`apps/api/src/index.ts:296-301, 565-578`). phases.md:126-151 still says 404. See N9 |
| 11 | Three issue-free UTC dates of policy-shadow evidence | PARTIALLY EVIDENCED (private) | `~/.codex/taskdesk-evidence/2026-10-09/p0-oct9-runtime-adjudication.md` covers 9 behaviours. `task-source-date-compatibility-sol.md` covers 12 task reads. The Oct 9 ruling says it "does not automatically satisfy three dates for all 27 selected sources". I found no single ruling for all sources |
| 12 | Signed-main release installer upgrade and rollback | MET WITH A DEFECT | alpha.3 proof PASS. U6 passed only after a hosts-file workaround (FND-1). The run was "hybrid": the starting point was edge sha-8ddb plus alpha.3's deploy.sh, not an installer-installed earlier release. See B1 and N10 |
| 13 | DoD: every feature meets its DoD | Not independently re-established | Per-PR records only |
| 14 | DoD PG1 screen review | DEFERRED (allowed) | DoD:169-174; decision log 2026-10-02 |
| 15 | DoD: every P0 screen ✅ in the screen inventory | **UNMET** | `docs/02-design/screen-inventory.md:23-36, 169, 179`: P0 rows are ⬜ or 🟡; none is ✅ |
| 16 | DoD: full E2E suite green, agent and portal, plus reduced motion | **UNMET / not evidenced** | The only required E2E context is `e2e - protected-route redirect`. I found no full-suite or reduced-motion run recorded for the stage |
| 17 | DoD PG2 screen reader, PG3 keyboard session, PG4 fresh-eyes, PG5 cross-browser | **UNMET** | No evidence on main. PG2, PG4 and PG5 (with the k6 baseline) rest on decision-log § Waivers 2026-09-05, "Approved by: *pending — Thomas*" (decision-log.md:6520-6524). A pending waiver is not an approval, and a waived gate counts as unmet |
| 18 | DoD PG6: realistic data (10k items, 50 projects, 200 people) | **UNMET / not evidenced** | No stage-level record |
| 19 | DoD: load-test baseline recorded | **UNMET** | Pending waiver (row 17) |
| 20 | DoD: backup **and restore** verified | **UNMET** | Proof F2 records a pg_dump. R3 says "no pg_dump restore needed". OrbStack refreshes took encrypted backups. No restore has been verified |
| 21 | DoD: phase finalizer | THIS REPORT | Verdict NOT COMPLETE |
| 22 | DoD: written stage review in 07-planning, including what went wrong | **UNMET** | None found |
| 23 | DoD: screen inventory, feature index and CHANGELOG updated together | **UNMET** | `CHANGELOG.md:11-63` has no alpha.1–alpha.3 entries even though all three prereleases were published |
| 24 | DoD: roadmap and status updated | **UNMET** | `status.md`'s newest snapshot is 2026-10-05 and still records main as 8ddb9de8 |
| 25 | DoD: Gates table complete, every waived row linked to the decision log | **UNMET for #602** | #602's Gates table says "No gate is waived", but a required check was lifted for its merge. No decision-log entry exists (B3) |

---

## Findings

### B1 — BLOCKING. The installer re-run fails on a files.<domain> name it wrote itself (in-flight finding 1)

**Where.** `install.sh:299` on main writes `TASKDESK_FILES_HOST=files.${DOMAIN}` on every first install (`EXISTING_ENV == 0`). It does this even without the S3 profile and without a DNS check. On the next run:

- `install.sh:65` reads that value back.
- `install.sh:126` adds it to the production DNS preflight.
- `install.sh:129` then dies.

**Scenario.** A customer installs alpha.3 in production without S3 and without a files DNS record. Their next upgrade or re-run through `install.sh` exits rc 1 with "DNS name files.<domain> does not resolve". This is the evidence in `vm/install-rerun1-dns-failure.log`. The failure is safe (nothing changes), but the documented upgrade path is broken for the default topology. `configuration-reference.md:122` says TASKDESK_FILES_HOST "matters only when the S3 profile is enabled".

**Fix status.** Branch `claude/p0-installer-rerun-fix` at a0bc2f67 is not merged. It preflights the files host only when `PROFILE_S3 || FILES_HOST_SET`.

**What I verified on the fix:**
- On a clean export of a0bc2f67, `node --test scripts/ci/install.test.mjs` passes **48/48**.
- **Negative control:** I ran the two new tests with main's `install.sh` swapped in. "production first install and re-run without a files DNS record or S3 profile both succeed" **fails** with the exact production error, so the test is not vacuous. The S3/explicit-host negative test passes on both, as it should.
- The pinned installer hash moves from cd4078e8… to ab4e319e…. The runbook pin and its byte-equality test are updated.

**Must it merge before P0 is claimed? Yes.** Verification needed:

1. The unit/integration test above (done, non-vacuous).
2. The normal review tier for a security-scope path (`install.sh`): an ordinary review plus a Sol-tier pass at the exact head.
3. A **targeted real-VM re-proof, not the full matrix:**
   - fresh production install with the fixed `install.sh`, no files DNS record, no S3 profile and no hosts workaround;
   - immediate re-run (U6);
   - an installer-to-installer upgrade from an earlier signed release (for example alpha.2 → alpha.3) whose `.env` was written by the installer;
   - one S3-profile negative.

A full VM matrix is not needed. The release archive does not contain `install.sh`; I extracted alpha.3's archive and it is byte-identical to `git archive b704f707 compose.yml deploy scripts/deploy.sh scripts/lib/local-certificate.sh scripts/lib/deploy-checks.sh`. The image, `deploy.sh` and the compose files are therefore unchanged by the fix. Step 3 also closes N10.

### B2 — BLOCKING. Stage-gate items have no evidence or rest on an unapproved waiver

Exit-criteria rows 15–20 and 22–24 (DoD:175-192). `active-mission.md` (Formal stage closure) says the stage gate "is not automatic under this mission".

**Scenario.** If P0 is claimed now, it is claimed with no screen-reader, keyboard, fresh-eyes, cross-browser, 10k-data, load or restore evidence. The only cover is a 2026-09-05 waiver still marked "pending — Thomas".

**Decision Thomas must make:**
- either confirm the 2026-09-05 waiver (run PG2, PG4, PG5 and k6 once before 2.0.0) and state whether PG3, PG6, full E2E/reduced-motion and backup-restore are also deferred;
- or have them executed for P0.

Separately, the stage-review document, CHANGELOG, screen inventory and status updates are records work for the conductor.

### B3 — BLOCKING (records). #602 merged through a lifted required check, with no decision-log record

**Ruleset history** (22365005; actor ThomasHeinThura):

| Version | Time (UTC) | Change |
| --- | --- | --- |
| v51940483 | (before) | 18 contexts, including `pull request template + security review` |
| v52653414 | 02:13:05Z | context removed (17 contexts) |
| — | 02:13:44Z | #602 merged |
| v52653571 | 02:15:37Z | context restored |

The conductor's own evidence files document the lift: `~/.codex/taskdesk-evidence/2026-10-10/protect-main-{before-602-lift,during-602-lift,after-602-restore}.json`.

**Why this blocks:**
- #602's PR body says "Thomas chose a one-time owner removal … (decision 2026-10-10)". No such entry is in `decision-log.md`.
- The decision log's 2026-10-09 "Model tiers by availability" entry (lines 186-191) says the earlier lift for #602 was "withdrawn" and "the ruleset was not changed".
- #602's Gates table says "No gate is waived", which contradicts the merge.
- The same body says integration and e2e were re-run **twice** (Docker Hub HTTP 500), "which Thomas authorized for this incident". The 2026-10-09 policy allows **one** re-run per incident (decision-log.md:247-253). The second re-run's authorization is not recorded either.

The GitHub account that changed the ruleset is the same one every agent merges with, so the record cannot be attributed from GitHub alone.

**Remediation.**
1. Append a decision-log entry for the 2026-10-10 lift and the second re-run, sourced to Thomas.
2. Supersede the "withdrawn" sentence by reference. The log is append-only, so do not edit it.
3. Add a waiver row for #602's template check.

The underlying review is not in doubt. The only template error was the literal model match. The calibration delta has a truthfully labelled Opus Sol-tier review, and #616 later made the check model-aware.

### B4 — BLOCKING (records). Control-plane records are stale

- `docs/07-planning/status.md:1-20` is newest on 2026-10-05. It records "Main rechecked 8ddb" and does not mention #602–#622, the alpha.1–alpha.3 prereleases or the installer proof.
- `active-mission.md` points to `docs/07-planning/integration-execution-queue.md`, which does not exist on main (see N11).

A stage cannot close on records that contradict GitHub. CLAUDE.md: "If status.md and GitHub disagree, GitHub is newer. Correct status.md".

### N1 — NON-BLOCKING. Docs mismatch on the live health response (FND-2)

`container-image.md` says `/api/public/health/live` returns `{version, sha}`; it returns `{"status":"ok"}` (proof U5). The fix is in flight on the same branch (a0bc2f67 touches container-image.md). Merge it with B1.

### N2 — NON-BLOCKING. Upgrade and rollback force re-sign-in (FND-3)

The session cookie is now `__Host-tdk_agent_session` / `__Host-tdk_portal_session` (`apps/api/src/auth.ts:984-997`). Sessions issued by the older image do not survive an upgrade, and old/new cookies are not interchangeable after a rollback. This fails safe. The runbook note is in flight (runbook.md +6 on a0bc2f67).

### N3 — NON-BLOCKING. Rolling the 80-migration image back onto the 120-row schema is safe by additive design, not by contract

**Doctrine.** `docs/04-engineering/migrations.md:83-84` guarantees only that "the previous image still works against the current schema". R3 went back 40 migrations (8ddb9de8, 80 → 120), skipping alpha.1 and alpha.2 (88).

**What I checked:**
- 0088–0119 `when` values are strictly increasing. The journal has 120 entries; its only non-monotonic pairs are historical (0005/0006, 0024–0026).
- Drizzle's created_at cursor therefore neither skips nor re-runs anything in either direction.
- The DDL is additive, apart from constraint swaps on instance_setting/step_up and one index change (below).

**Where it is luck rather than design:**
- 0093 replaces a non-unique index with `UNIQUE (person_id, scope, scope_id)` on `membership`.
- 0081 adds the `session_portal_allowed` CHECK.
- An old image that writes a duplicate membership now gets 23505 (a 5xx) instead of a row. That fails closed but is untested.
- R3 exercised boot and reads only. Old-image writes were not exercised.
- 0119 touches only tables (saved_view, notification_delivery) that 8ddb does not have, so it is irrelevant to that image.
- The old image's migrator silently accepts a database that is ahead of its journal. Nothing warns.

**Recommendation.** Have the runbook name the supported rollback target as the immediately previous release. Consider a schema-ahead warning.

### N4 — NON-BLOCKING (process). Some reviews fall below the count in the review table, with no recorded rationale

The table is `agent-workflow.md` § How many reviews.

- **#621.** One ordinary review (a36586d5 at 22c1ee7d). The change alters a security control's core semantics: the port-publication guard and digest identity. The table row is "two to three". The Sol pass found B-1, a real fail-open of the TRUST_PROXY guard, that the ordinary review missed. The B-1 delta was re-reviewed only by the security context.
- **#619.** One ordinary review. It is defensible as a "bounded … fix", but the PR body records no tier.
- **#602 calibration delta.** One ordinary context, three rounds, on G11 gate semantics.

**Recommendation.** Record the tier rationale in each note. Consider a sampled second ordinary review of #621.

### N5 — NON-BLOCKING (supply chain). A manual release can name any commit reachable from main, not just merged heads

`.github/workflows/release.yml:84-87` requires `source_sha` to be `merge-base --is-ancestor … origin/main`. That covers **1,624** commits reachable from 954eb840, against **351** first-parent commits. The other 1,273 include unreviewed intermediate commits from the merge-commit era (for example `001bb985`, a branch-sync merge).

A maintainer `workflow_dispatch` could build, sign (`tag=v…`, `source_sha=…`) and publish one of them. It cannot release an **unmerged** SHA: the job is gated by `github.ref == refs/heads/main` (lines 33, 230), and both `deploy.sh` and `install.sh` pin identity `release.yml@refs/heads/main`.

**Recommendation.** Require `source_sha ∈ git rev-list --first-parent origin/main`.

Everything else in this area holds:
- Signing binds the exact scanned digest. Trivy scans the platform digests read from `${IMAGE}@${DIGEST}` (lines 174-210), and cosign signs `${IMAGE}@${DIGEST}`, the index whose content hash covers those platform digests (lines 314-321).
- The installer authenticates the archive through both cosign bundles plus the signed `.sha256`, not a hard-coded checksum (`install.sh:158-171`). That is correct.
- alpha.3's archive matches its `.sha256`. Its Fulcio certificate identity is `release.yml@refs/heads/main`, workflow_dispatch, SHA b704f707, run 38039306333.

### N6 — NON-BLOCKING. The template check trusts a self-declared model label

What the check (#615/#616) enforces:

- **Unlisted label:** rejected. Labels are matched exactly against the block read from the **merge base**, not the PR head (`scripts/ci/lib/review-models.mjs:1-60`); 49/49 tests pass.
- **Reviewed head not an ancestor:** rejected (`security-review-note.mjs` rule 2).
- **Non-note commits after the reviewed head:** rejected per commit, not by net tree (rule 3, GPT-F5).
- Squash merges orphan old reviewed heads, so an old note cannot be reused for a later PR.

What it cannot stop:

- **A listed but false label passes.** So does a typed reviewed-head SHA. The code says so itself (`security-review-note.mjs` "What this does not prove").
- **A PR that edits the checker runs its own copy.** The only mitigation is the security-path review.

The real control against forgery is the hashed transport of verbatim reports. It is checkable only by the conductor or an auditor, not by CI.

### N7 — NON-BLOCKING. G11 speed calibration can mask a regression within a known bound

**How it works.** Normalisation is raw / F^k with F clamped to 0.75–1.75. k is clamped to [0, 1] and floored, so list, board and LCP use k = 1 even though their measured sensitivity is 1.06–1.15; that is stricter than exact.

- R0 is pinned by literal workload and option hashes (`performance-calibration.mjs:35-45, 156-245, 405-432`).
- Calibration runs at job start in a fresh browser context (`apps/web/e2e/performance.bench.ts:79-144`).

**Observed factors:**

| PR | Runner CPU | Factors (unthrottled / throttled) | Effect |
| --- | --- | --- | --- |
| #622 | fast (EPYC 9V45) | 0.976 / 0.798 | judged more strictly than raw |
| #621 | slow (EPYC 7763) | 1.382 / 1.337 | normalised |
| #618 | slow (EPYC 7763) | 1.330 / 1.235 | normalised |

**Masking paths:**
1. By design, a regression up to F^k passes on a slow runner. Thomas accepted this in the 2026-10-10 decision.
2. Not covered by that decision: the API and web servers run on the same runner during calibration. A product regression that burns idle CPU would inflate F and partly normalise itself away.

**Recommendation.** Alert when F exceeds about 1.2 on a CPU model that previously recorded F ≤ 1.0. Re-record R0 if the pool changes.

### N8 — NON-BLOCKING (post-P0, S1 interacts with P0's CSRF control)

`apps/api/src/utils/csrf-protection.ts:9, 226-230` applies the double-submit CSRF check only when `__Host-tdk_agent_session` is present. After #622, the portal host admits mutating customer auth endpoints (sign-out, 2FA verify, local sign-in variants; `index.ts:296-301, 565-578`) with `__Host-tdk_portal_session`. Those requests skip the TaskDesk CSRF middleware. They rely on Better Auth's origin checks and SameSite=Lax.

This is not exploitable today: there are no `kind: "portal"` mutating policy routes. It becomes a gap when the first one lands. Track it in P3.

### N9 — NON-BLOCKING. Main has moved past the P0 contract

After #622, main (954eb840) no longer matches the P0 two-entry matrix (`phases.md:126-151`, "Other /api request → Generic 404" on the portal host). `customer-portal.md` was updated; `phases.md` was not. I saw no image-boot or installer evidence for 954eb840. Its release push run 38040321782 built, scanned and signed edge only.

**Recommendation.** Bind the P0 claim to b704f707 / v2.0.0-alpha.3 and say so in the stage review.

### N10 — NON-BLOCKING. No real installer-to-installer upgrade has been proven

The proof was "hybrid" (`result.json` mode): the starting point was edge sha-8ddb seeded with alpha.3's `deploy.sh`. FND-1 survived the first two attempts precisely because no starting point had an installer-written `.env`. B1's targeted re-proof closes this.

### N11 — NON-BLOCKING. The queue file the active mission names is missing

`active-mission.md` names `docs/07-planning/integration-execution-queue.md` as the home of task state. That file does not exist on main.

### N12 — NON-BLOCKING. U7 tests the tools, not install.sh

U7 shows that `sha256sum -c` and `cosign verify-blob` reject a tampered archive (`U7-tamper.log`, rc 1 each). It does not run `install.sh` end to end against that archive. That `install.sh` itself rejects one before any write is shown by unit tests: "cosign rejection stops before creating or changing the install directory" and "checksum mismatch is rejected even when signatures are explicitly skipped". Both pass in the 48/48 run.

### Cross-PR checks with no finding

- **#617 + #621 + installer.** `deploy.sh` now derives the digest from the registry bytes (`deploy-checks.sh:95-108`), and #617's awk parse survives only in `release.yml`'s immutable-tag check (line 404), so the two derivations no longer interact. U5 confirmed the running RepoDigest equals the verified digest. `verify_signature` binds `--annotations tag=${TASKDESK_IMAGE_TAG}`, so a signed edge or `sha-` image cannot pass for a `v*` tag. R4 confirmed the installer clears a retained rollback digest when the version changes (`install.sh:283-287`).
- **#619 + host guard.** `appPublicOrigin` is set only from validated configured origins after host selection (`index.ts:549-563`). `requirePublicAppOrigin` throws when it is absent. No Host, `X-Forwarded-*` or `c.req.url` origin reaches signed URLs.
- **Policy check edges.** No forged-ancestor or revert bypass beyond N6.

---

## Commands run (all read-only, except scratchpad exports and the release download)

- `git fetch origin`; `git rev-parse origin/main` → 954eb840…; `git log --first-parent`
- `git archive 954eb840 | tar -x -C <scratchpad>/main`; `git archive a0bc2f67` (from /private/tmp/claude-501/p0fix) → `<scratchpad>/fix`
- `gh pr view {602,615..622} --json number,state,headRefName,headRefOid,mergeCommit,mergedAt,reviewDecision,statusCheckRollup,body`
- A bash script per PR: merge parent count, head-on-parent ancestry, `git diff --quiet head merge`, and the newest ancestor `**Reviewed head:**` with the non-note files after it
- A Python script recomputing the SHA-256 of every BEGIN/END REPORT block (39 OK)
- `gh api repos/…/commits/<sha>/check-runs` for 602, 615, 616, 617; `gh run view 38014207174 --job 114100783710 --log`
- `gh api repos/…/rulesets`, `…/rulesets/22365005`, `…/rulesets/22365005/history`, and `/history/{51940483,52653414,52653571}`; `gh api users/…`, `pulls/N` (`merged_by`)
- `gh release view v2.0.0-alpha.{1,2,3}`; `gh run list --workflow release.yml`; `gh api actions/runs?head_sha=…`
- `gh release download v2.0.0-alpha.3 -p 'taskdesk-v2.0.0-alpha.3.tar.gz*'`; `shasum -c`; archive content `diff -r` against `git archive b704f707 …` (equal); openssl inspection of the Fulcio certificate
- `shasum -a 256 -c SHA256SUMS` in `p0-installer-proof-3-20261010T090655Z`: 148/148 OK, with no files unlisted or missing
- Reads of `result.json`, `U7-tamper.log`, `digests.txt`, `installer-sha.txt`, `vm/install-rerun1-dns-failure.log`, `P2-attestations.log`
- Reads of the two Oct 9 evidence adjudications (three-date)
- `node --test scripts/ci/install.test.mjs` on the a0bc2f67 export: 48/48. Negative control with main's `install.sh`: the new test fails, as expected
- `node --test scripts/ci/lib/review-models.test.mjs scripts/ci/lib/performance-calibration.test.mjs` on the main export: 49/49
- G11 job logs for #622, #621 and #618 heads (calibration factors)
- Python journal monotonicity check; grep of 0080–0119 DDL for destructive or constraint changes
- Source reads: `release.yml`, `install.sh`, `deploy.sh`, `deploy-checks.sh`, `auth.ts`, `csrf-protection.ts`, `index.ts` host guard, `request-origin.ts` diff, `review-models.mjs`, `security-review-note.mjs` header, `performance-calibration.mjs`, `performance.bench.ts`
- Doc reads: AGENTS/CLAUDE policy sections, `active-mission.md`, `phases.md`, `definition-of-done.md`, `agent-workflow.md` § Reviews, `status.md` head, decision-log entries from 2026-10-02 to 2026-10-10 plus § Waivers, `migrations.md`, `screen-inventory.md`, `CHANGELOG.md`

The disposable `p0fin-pg` container was **not** used. No database test needed it.

## Residual risk

- **Installer.** Until B1 merges and is re-proven, every default-topology production install has a broken re-run and upgrade path. It fails safe.
- **Rollback.** Going back to any image older than N-1 is unsupported in principle (N3). Old-image writes against constraints added later are untested.
- **G11.** Calibration can hide a regression up to F^k on slow runners, or if the regression itself inflates F (N7).
- **Release workflow.** Manual dispatch can release unreviewed intermediate commits reachable through old merge commits (N5).
- **Review integrity.** It still rests on self-declared labels and conductor-verified transport. CI cannot detect a forged listed label (N6).
- **Independence.** This finalizer was spawned by the session that merged #617–#622 (see the disclosure above).

## What was not checked

- I did not cryptographically verify any cosign signature, GHCR image signature or attestation. cosign is not installed here. I inspected only the Fulcio certificate and the evidence logs (P2 rc 0).
- I did not run the full unit, integration or E2E suites, typecheck or lint, and did not boot any image. That includes 954eb840.
- I did not re-review the #618 migration bodies beyond a DDL scan, nor the S1 identity code beyond its interaction with the host guard and CSRF.
- I did not re-verify the router-retrofit Sol review, the kaneo baseline counts, or the per-source three-date coverage for all 27 sources. I read only the two Oct 9 adjudications.
- I did not inspect the failed proof attempts (`p0-installer-proof-20261010T024034Z`, `-2-20261010T044523Z`) beyond listing them.
- I did not check #615/#616 policy prose against every earlier decision.
- I did not check `stable.txt` hosting (get.taskdesk.dev) or its integrity.
- I did not perform any VM, DNS or real-resolver test of the installer fix.

---

## Re-check 2026-10-10

Reviewer model: Claude Opus 5.5 (claude-opus-5-5). Same context as above, with the same independence disclosure. Read-only. The `p0fin-pg` container was not used.

**Reviewed head:** f4f6b0114fb20594b56e1d305c59c7efef23ec15
**Reviewed head:** f7aa71ac022510c8901a4d5a8b0fa4a23e6f2515
**Reviewed head:** 48e07b8e2e726932cb86a76125b4883e9626a96a

These are, in order: main after #623; PR #624 (open); and branch `claude/p0-stage-closure` (local, not pushed).

### Verdict: P0 COMPLETE CONDITIONAL ON

1. **Merging #624, after three fixes:**
   - (a) A second independent ordinary review. Decision-log entries are excluded from the records-only tier (`agent-workflow.md` § How many reviews), so the "ordinary substantive: two" row applies. #624 has one Sonnet review.
   - (b) Refresh its `status.md` snapshot to main `f4f6b011`: #623 merged, and proof 4 cases 1–3 PASS with case 4 not possible. As written, the snapshot says main is `954eb840` and the B1 fix is still pending, so B4 would reopen the moment it merges.
   - (c) The waiver must name screen-inventory ✅ (exit-criteria row 15) explicitly. Thomas's widened list in #624 covers PG2–PG6, k6, 10k data, full and reduced-motion E2E and backup restore, but not row 15. The entry even says "screen-inventory records are still required". The screen-inventory note on the closure branch attributes the missing ✅ to this waiver by inference. **Thomas must confirm that row 15 is covered.** Otherwise row 15 is unmet.
2. **Pushing, reviewing and merging `claude/p0-stage-closure`, after these corrections:**
   - (d) **CHANGELOG `[2.0.0-alpha.3]` § Security is wrong.** It credits #621 with binding the signature check to the release tag. That check (`--annotations "tag=${tag}"`) already existed before #621: `git show 3096cb04:scripts/deploy.sh` line 300. Remove the bullet or re-attribute it.
   - (e) **CHANGELOG `[2.0.0-alpha.3]` Known issues: "Rolling back is proven only to the immediately previous release" is wrong.** Proof 3's R1–R3 rolled back to the edge image `sha-8ddb9de8` (schema 80), not to alpha.2. That proved boot and reads only; old-image writes were not tested. No release-to-release rollback has been proven, and alpha.2 cannot complete a production install (proof 4 case 4). State exactly that.
   - (f) **Row 11 wording in the stage review.** Say that the three-date rule gates *activation of a strict policy source* (decision log 2026-10-04, `TASKDESK_POLICY_ENFORCE`), not stage exit. Say that the P0 claim activates no persistent strict source. See the row 11 ruling below.
   - (g) Fill the `## Phase finalizer` section with this re-check verdict.
   - (h) Row 24: either update `roadmap.md` for the P0 claim or record why it does not change.
   - The branch also touches `phases.md` and `screen-inventory.md`, which a check reads (G5 inventory). So it is not records-only either: it needs two independent ordinary reviews.

Once 1 and 2 are merged as stated, P0 may be claimed **for `v2.0.0-alpha.3` (`b704f707`) plus installer `f4f6b011`**. It does not cover later main. No further finalizer pass is needed for those records-only corrections, as long as the merged content matches the wording above. The conductor verifies that over the landed commits.

### Per-blocker status

**B1 — CLOSED.**
- #623 head `bcf8a70b` squash-merged as `f4f6b011`. Its tree is equal to the head, and the head was based on the previous main (`954eb840`).
- Diff against `954eb840`: `install.sh`, `scripts/ci/install.test.mjs`, three ops docs and the review note. The image, `deploy.sh` and the Compose files are not touched.
- The note `p0-installer-rerun-fix.md` binds Sonnet `a013334b` (APPROVE) and Opus `a1e45876` (PASS) to `a0bc2f67`. That is the same head I tested earlier: 48/48 tests, with a non-vacuous negative control. Both report SHA-256 markers verify.
- Tier: one strong ordinary review plus a full Sol pass, matching the "bounded security fix" row. Every required check is green at the head.
- Proof 4 (`p0-installer-proof-4-20261010T115535Z`): `SHA256SUMS` re-verified, **103/103 OK**, no files unlisted or missing.
- `install-new.sh` is `ab4e319e…`, equal to `git show f4f6b011:install.sh`. `install-old.sh` is `cd4078e8…`, equal to `b704f707`. `install-alpha2.sh` is `23e80455…`, equal to `511c917f`.
- Case 2 is the real customer path: the old installer writes the `.env`, then the old re-run fails (rc 1, FND-1 reproduced, no state change), then the new re-run succeeds (rc 0, data, secrets and health preserved). This closes the substance of N10, which was a `.env` written by the installer.
- Case 3, the S3 negative, fails before any write, on both an existing install and a fresh directory.
- Case 4 is not possible. `case4-diag.txt` shows alpha.2's `deploy.sh` rejecting compose port `:0` on Ubuntu Compose 2.40.3, with `PortBindings={}`. I accept that as a property of alpha.2. It means no installer-to-installer upgrade between two releases has been proven. Keep N10 as a residual for the next release pair.

**B2 — CLOSED by recorded waiver, except row 15.** #624's decision-log entry and its waiver row confirm and widen the 2026-09-05 waiver: PG2–PG6, k6, 10k data, full and reduced-motion E2E and backup restore, run once before `2.0.0`. The rows are insert-only (0 removed lines) and sourced to Thomas. Per the brief, a waived gate is unmet. So these rows stay **unmet but owner-waived**, and the stage review records them as "not run, deferred", which is correct. Row 15 is not in Thomas's list: condition 1(c).

**B3 — CLOSED in content (on merge of #624).**
- The entry records the #602 lift and the second infrastructure re-run with times. The lift times match the ruleset history I fetched (02:13:05Z, 02:13:44Z, 02:15:37Z).
- It names the waiver honestly and adds a waiver row linked to it. It supersedes the "withdrawn" sentence by reference, without editing it.
- Cosmetic: the #602 waiver row has two **Follow-up** fields.

**B4 — NOT YET CLOSED.** The #624 snapshot was correct for `954eb840`. It is already stale against `f4f6b011` and proof 4: condition 1(b). The claim that the queue file lives on #601's branch is noted, not verified. The statement that #599, #612 and #614 are closed is correct.

### Row 11 (three issue-free UTC dates): still open, not waived, but not a stage-exit criterion

- The rule (decision log 2026-10-02; `agent-workflow.md:320`) is how P0 policy-shadow verification is done.
- The 2026-10-04 entry makes it the precondition for adding any source to `TASKDESK_POLICY_ENFORCE`. It also says that entry "does not satisfy the real three-date observation, authorize a live cutover … or claim P0 complete".
- Neither `phases.md` "Done when" nor the DoD stage list contains it.
- The evidence is adjudicated for 9 changed behaviours and 12 task reads. It is not adjudicated for all 27 sources.

**Ruling.** Row 11 does not block the P0 stage claim, provided the claim states that **no strict policy source is persistently activated**. Enforcement defaults to empty, and the task-last strict/rollback run was disposable only. Before any source is activated, three-date evidence for that source remains a hard precondition. If Thomas regards persistent strict cutover as part of P0, row 11 blocks instead. **Question Thomas must answer** only if that is his intent.

### New findings

- **R1 (in condition 2d)** — CHANGELOG misattributes the release-tag signature binding to #621.
- **R2 (in condition 2e)** — CHANGELOG misstates which rollback was proven.
- **R3 (in condition 1b)** — the #624 status snapshot is stale against `f4f6b011`.
- **R4 (in conditions 1a and 2)** — #624 has one ordinary review where the table requires two. The closure branch needs two as well.
- **R5 (in condition 1c)** — screen-inventory ✅ is not in the owner's waiver wording.
- **R6 — NON-BLOCKING.** The `github-advanced-security` check is `failure` at the heads of #623 (`bcf8a70b`) and #624 (`f7aa71ac`). It is a dynamic Copilot-agent run (38045458303) whose log shows a runtime-download retry failure. It is not one of the 18 required contexts, and CodeQL, GitGuardian and the secret scan passed. It is noise, but record it, so that "all checks green" is not claimed literally.
- **R7 — NON-BLOCKING.** alpha.1 and alpha.2 cannot complete a production install: the digest parse and the `:0` port defect. Add "superseded; do not install" to their GitHub release notes, not only to CHANGELOG.

**Stage review accuracy.** Apart from R1, R2, row 11 and the empty finalizer section, `p0-stage-review.md` at `48e07b8e` is accurate and does not overstate. I checked:
- the binding to `b704f707` + `f4f6b011`;
- the merge table and the release table;
- rows 1–10 and 12–25 against my original table;
- the "What went wrong" items. Proof 1's digest-parse failure and proof 2's port-assert failure match the files in their evidence directories (`F1-digest-parse-failure.txt`, `F1-port-assert-diagnosis.txt`; both `result.json` overall FAIL).
- the residual N-items.

It correctly marks rows 15–20 "not run / deferred, a deferral not a pass", and says no image boot or installer evidence exists after `f4f6b011`.

### Commands (re-check)

- `git fetch origin`; `git rev-parse origin/main` (→ f4f6b011); `git log --first-parent -3`
- `gh pr view 623 --json headRefOid,mergeCommit,state`; `git diff --quiet bcf8a70b f4f6b011`; `git merge-base --is-ancestor f4f6b011^ bcf8a70b`; `git diff --stat 954eb840 f4f6b011`; `git log 954eb840..bcf8a70b`
- `gh api commits/bcf8a70b/check-runs`, `commits/f7aa71ac/check-runs`; `gh run view 38045458303 --log-failed`
- `git show f4f6b011:docs/07-planning/security-reviews/p0-installer-rerun-fix.md`, with the report-hash script: 2/2 OK
- In proof 4: `shasum -a 256 -c SHA256SUMS` (103 OK, 0 failed); a completeness comparison (none unlisted or missing); `result.json`; `vm/c2-old-rerun.log`, `vm/c2-new-rerun.log`, `case4-diag.txt`; `shasum` of the three installer copies against `git show {f4f6b011,b704f707,511c917f}:install.sh`
- `gh pr view 624` (head, state, body § Reviewed by / Security review); `gh pr diff 624` (94 lines, 0 deletions); `git merge-base origin/main f7aa71ac` (= f4f6b011); `gh pr view {599,612,614}`
- `/private/tmp/claude-501/p0close`: `git rev-parse HEAD` (48e07b8e, clean); `git log origin/main..HEAD`; `git diff origin/main...HEAD` for the stage review, CHANGELOG, screen inventory and `phases.md`
- `git show {24a48912,3096cb04}:scripts/deploy.sh | grep 'annotations "tag='` (R1)
- Listing and `result.json` of proofs 1 and 2; the R1–R3 lines of proof 3's `result.json` (R2)
- `decision-log.md:707-750` (2026-10-04 strict-enforcement entry) and `agent-workflow.md:314-326` (row 11)

### Not checked in the re-check

- I did not verify the owner statements quoted in #624 ("lifted. now go.", the 17:56 and 01:28 UTC authorizations). They are recorded by the conductor. Their timing is consistent with the ruleset history and the run history only.
- I did not run any VM or installer myself. I did not verify cosign cryptographically.
- I did not verify that `integration-execution-queue.md` exists on #601's branch.
- I did not re-review #623's code beyond what I tested at `a0bc2f67` and the head and merge identities above.
<!-- END REPORT (sha256 95a7bed41c39674a80022f945f15a870f688ef1f3c45fb37455667b10bddc9d8) -->

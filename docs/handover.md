# Handover — 4 November 2026 (Claude → Codex)

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md) first. Thomas's current instructions override everything here.

## Who works on version 2

From 4 Nov Thomas hands version 2 back to **Codex**. Codex owns the release chain and works in the main checkout without creating worktrees. Model tiers and review rules are in AGENTS.md.

## Goal

**UAT launch on Friday 6 November 2026** on the Technexus hosts. Thomas does the final human verification with the credential files on his Mac (`~/.taskdesk/sit-credentials.json` for local SIT, `~/.taskdesk/uat-credentials-technexus.json` for Technexus). They never go into docs, logs or PRs.

## State now

- **5 Nov release:** `e08c7063ae9a384252066407193662bca8740c24` is accepted on local SIT and Technexus, with signed index `sha256:d34875df206d7c0b3acad20d8ee37911e740fc093df077aa120f4d776c931989`. Release run 41989194302 passed both jobs; source provenance and cosign signature were verified. Release-path fixes #1055 and #1057 shipped; #1056 is closed. This does not complete fresh-customer installation acceptance.
- **Local SIT:** 68/68 smoke checks passed across six roles and both HTTPS hosts; journal 217 and eight attachment hashes were verified. The quiesced backup contained 184 tables and 48,279 rows. A new QA workspace, project and lead/viewer accounts were created through product APIs; the original four credential entries were preserved and setup did not change existing workspace/project grants. A private operator hit a name-shadowing `TypeError` after the signed helper verified the new app, leaving the lock held. Independent read-only acceptance verified the same candidate, backup, HBA, configuration and counts before unlock; no second migration or restore ran. Superseded legacy local deployments remain stopped with their volumes preserved.
- **Technexus:** the quiesced backup contained 184 tables, 69,976 rows and four files. Initial post-deploy counts were identical. The new image is healthy; normal macOS TLS checks on both hosts passed before and after smoke. Signed-in smoke was 108/110, with two expected empty-workspace instance-admin misses and all 54 browser checks passing; the lock was released.
- **Queued fixes:** #1046 → #1047 → #1048 → #1049 → #1050 → #1051 → #1052 → #1053 → #1054, each separately qualified and released. Calendar source head `6bfdd0a6` passed 17 required checks, six hosted G13 cases and 30 + 12 persisted-source browser cases; independent Terra review recommended acceptance of the scoped change. Final documentation-head CI and merge remain pending; none of these PRs is merged.
- **Storage:** filesystem is active. SeaweedFS is approved as a provider, but #1052 and #1053 remain inactive configuration work; no bytes have been cut over.
- **Audit scope:** 30 Technexus owner desktop-dark rows were reviewed observationally and 24 screenshots independently inspected: 17 observations, four redirects, two design observations, one runtime observation and six fixture blocks. Focused security checks resolved the observed 403 as expected and isolated the Inbox result to a Chrome focus boundary; neither confirmed a medium bug. Open findings: agent not-found heading/recovery (#1059), keyboard-clear focus (#1060) and mobile Calendar toolbar overflow (#1061). The latter two predate #1046. The 154-row route inventory is statically reconciled, not fully browser-verified; calendar source checks do not complete it.
- **Dependencies:** the audit reports three advisories, comprising one low and three moderate instances, with no high or critical findings. Production low `deepmerge` remains #909; development upgrade #1058 awaits approval for new transitive packages. No dependency was changed.
- UAT items U-1 to U-15 in the [roadmap](roadmap.md) are done and live:
  - Overview tab;
  - portal redesign: dashboard, cases, Projects and Project Details, Announcements;
  - staff-raised tickets with the Requester field;
  - signed portal file links, both ways;
  - Documents register and Pages;
  - reports that fit their frame;
  - the Kaneo pass;
  - the triage panel;
  - managed services;
  - God Mode sign-in methods;
  - speed fixes.
- **3 Nov re-audit.** A full browser re-audit across six lenses confirmed 64 findings; each was reproduced by an independent skeptic. All highs and mediums are fixed in #1033–#1043. The lows are listed below.
- **Speed.** Technexus board/list request: handler 35–45 ms with SLA at 15–19 ms (Server-Timing), down from 1.2–4.1 s (#1034).
- **Release workflow.** It broke upstream on 4 Nov: Trivy's install script changed. #1044 pins the Trivy install to the v0.73.0 tarball with a verified SHA-256, approved by Thomas. If Trivy needs a version bump later, update `TRIVY_VERSION` and `TRIVY_SHA256` together.

## Thomas's decisions since 31 Oct

All are recorded in [design-and-decisions](technical/design-and-decisions.md).
- **Portal ownership.** A customer organisation owns the portal. Status is per engagement. Staff-raised tickets appear in the portal.
- **Pages and Documents.** Pages are staff-only. Documents is the register of links. A Page link stays staff-only for UAT; a portal page view comes after UAT.
- **Portal files.** They use person-bound signed links, both ways. Submission downloads are person-bound too (#1033).
- **Requester field.** Callers with `work_item:update` can set it, only to a customer of the project's organisation. Every change is audited.
- **Workspace reach.** Leads, managers and custom roles get exactly the reach their role row grants (#1035, #1042).
- **Managed-service create.** It asks for a service calendar when none resolves (#1041).
- **Documents edits.** Documents entries have a PATCH edit route (#1029).

## Release chain (every merge)

1. Merge to `main` → `release.yml` builds, Trivy-scans (HIGH/CRITICAL with a fix block publication), generates SBOMs, signs and publishes. Verify with `gh attestation verify oci://ghcr.io/thomasheinthura/taskdesk@<digest> --owner ThomasHeinThura --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml`.
2. **Local SIT:** use only `deploy/compose.testing.yml`. Set `SIT_COMPOSE_ENV` and `SIT_PRIVATE_DIR` to the private canonical configuration, with `SIT_IMAGE` pinned to the verified release digest and `TASKDESK_IMAGE_TAG` set to its signed release tag. `scripts/deploy.sh local` verifies both the release attestation and cosign signature, requires the initialized canonical database/cache and copied attachment volume, runs migrations, starts the application/proxy and probes readiness; it never imports data or seeds accounts. Run `node scripts/sit/release-smoke.mjs` afterwards. Before the first transition from a legacy deployment, back up its database, files and private configuration; verify the restored copy and file hashes, preserve the old volumes, and switch the proxy only after internal readiness. The old local invocation would reseed accounts and must not be used.
3. **Technexus:** take a `pg_dump -Fc` backup and verify it with `pg_restore --list`; back up the volume and `.env`, and record the counts. Then set the tag and digest, migrate, and run `up -d --wait`. Wait for both hosts' `/api/public/health/ready` to return 200 before checking anything; there is a startup window of about a minute. Run the signed-in smoke with the Technexus credentials file. **Once UAT users are on Technexus, every deploy asks Thomas first.**
4. Any failure stops the release. To roll back, restore the previous `.env`. If the migration count changed, also restore the database.

## Open after UAT (ordered)

- **Re-audit lows.** Each fix PR (#1033–#1043) lists its remaining low findings under "How it was checked". Known ones:
  - Submission form-field uploads still use the generic signed PUT: bound to key and size, not to a person.
  - On S3, portal downloads stay bucket-presigned (documented in AT-5).
  - Between `md` and `lg`, the collapsed calendar search does not tell screen readers that a search is active; the current fix is under CI review.
- **Product follow-ups.**
  - Portal read-only Page view.
  - Upload files as Documents entries.
  - Email provider (none for UAT; testers use seeded passwords).
  - Technexus self-registration is open during UAT (A-15, accepted by Thomas).
- **Earlier backlog.** God Mode completeness (A-29–A-34), the rest of L-04, L-05, L-02, #918/#920, L-06, L-07 and L-11.
- **Known flaky tests.**
  - Watch `project-managed-service-persisted` (URL timing) and the API reach-guard hook timeouts under heavy load; rerun before treating either as a regression.
  - Under load, a few web unit files (API-key dialog, role capabilities, command palette, quiet hours) time out and pass alone.

## Working notes

- **No worktrees (Thomas, 4 Nov).** Do not create git worktrees or worktree branches. Work in the main checkout (`Ticketing.v2`): one feature branch per PR, cut from an up-to-date `main` (`git switch -c fix/… origin/main`). Commit, push, open the PR, merge, then switch back to `main` and delete the merged local branch. Subagents work in the same checkout on disjoint files and never commit.
- **G8.** Regenerate baselines from the CI `playwright-visual` artifact, `<name>-actual.png` → `apps/web/e2e/visual.spec.ts-snapshots/<name>-linux.png`. Look at every image first. `check:visual-scope` allows only `toBeVisible` assertions with literal values.
- **Merge conflicts.** In `i18n/*.json`, merge three-way and keep both sides' keys. For `i18n/schema.json`, `pairs.json` and `openapi.json`, take main's copy and regenerate it (`pnpm i18n:schema`, `node scripts/ci/refresh-contrast-manifest.mjs --write` + biome format, `pnpm openapi:write`).
- **check:env.** It rejects test-only environment reads; write evidence screenshots with `test.info().outputPath`.
- **Workflow edits.** They need Thomas's approval (AGENTS.md).

## Never

- Touch the live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870.
- Weaken, skip or exempt a check, or change budgets, thresholds or calibration. G11 stays report-only.
- Write hosts, keys, credentials, cookies or database URLs into docs, logs or PRs.
- Remove a container except by exact id; never prune.
- Wipe or reseed Technexus, or edit Thomas's own records there ("test projects", the YOMA MS service), without asking.

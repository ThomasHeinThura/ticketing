# Handover — 10 November 2026

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md) first. Thomas's current instructions override everything here.

## Who works on version 2

Codex coordinates version 2. Independent Orca child worktrees hold draft work; the main checkout remains on the G11 branch. Use the middle and high tiers in AGENTS.md according to risk. Keep file ownership separate and use worker results as evidence, not acceptance.

## Goal

Complete the full audit, repair the remaining defects and qualify a clean seeded local SIT and Technexus UAT. Thomas approved replacing both environments after verified backups, confirmed no active testers, and directed use of the existing private credentials files. Credentials never enter docs, logs or PRs. Each later merge still needs his explicit approval.

## State now

- **10 Nov release:** #1103 merged as `b44125e97500fdd87eb07832411a84b10f1e60f7`. Release run 42770335074 passed build, scan, SBOM, sign and publish; signed index `sha256:223bd9969611370939a0b8bf4b5fcbfd575a39390a40ff98cf76508e22e6e5bc` is now the canonical local SIT application image. #1092's signed SIT-target upgrade and rollback helper shipped on 9 Nov.
- **Local SIT:** the existing data remains in place; a quiesced backup and isolated restore were verified before the signed upgrades. The current image is healthy, both HTTPS origins passed certificate-verified readiness, and six-account smoke passed 65/65. D11 passed its signed-SIT phone browser matrix. D14 passed 52 bounded checks, but a populated two-project customer fixture is absent. D15's live-reach download code passed isolated filesystem/S3 tests and disposable browser checks; signed-SIT download and live S3 acceptance remain open. This is an upgrade, not the requested clean reinstall.
- **Technexus UAT:** the last recorded image is signed `1f9d94910`; its current live digest was not rechecked in this checkpoint. No UAT app/data reset or deploy has occurred in this work. A 10 Nov private preflight backup passed file checks and an isolated database restore with matching core counts. Take and verify a fresh quiesced backup immediately before replacement; the preflight copy is not the cutover snapshot.
- **Clean cutover blocker:** main completes first-user setup before verified TOTP, contrary to the retained bootstrap contract. Draft #1098 addresses this; independent Sol review, focused browser checks and all non-G11 CI checks passed, but it remains unmerged. Draft #1089 supplies the clean demo seed and also remains unmerged. The private identity mapping is still incomplete. Do not reset either environment until the needed fixes are merged with Thomas's approval and a signed release is available; the clean path does not use #1089's existing-data rewrite.
- **Drafts:** #1091's earlier `ee9314ce8` head passed 25 other CI checks and assignment, board and drag budgets, but work-list LCP missed at 2549.1 ms against 2500. Its later preload experiment missed at 2747.3 ms; current head `afd730a19` restores the earlier preload gate and awaits CI. #1093's non-G11 checks pass, but real Reports-builder browser evidence remains open. The full 154-row audit is open. The offline browser policy blocks every request; after three failing attestation review rounds, a storage-alias high and migration-image medium remain, so the browser canary is paused for Thomas's direction.
- **Portal decision pending:** staff-raised cases show an ambiguous "Created by" value under the retained requester contract. Thomas has been asked to choose the presentation correction. The mobile Projects scroll cue is also open.

## Historical context

- **5 Nov release:** `e08c7063ae9a384252066407193662bca8740c24` is accepted on local SIT and Technexus, with signed index `sha256:d34875df206d7c0b3acad20d8ee37911e740fc093df077aa120f4d776c931989`. Release run 41989194302 passed both jobs; source provenance and cosign signature were verified. Release-path fixes #1055 and #1057 shipped; #1056 is closed. This does not complete fresh-customer installation acceptance.
- **Local SIT:** 68/68 smoke checks passed across six roles and both HTTPS hosts; journal 217 and eight attachment hashes were verified. The quiesced backup contained 184 tables and 48,279 rows. A new QA workspace, project and lead/viewer accounts were created through product APIs; the original four credential entries were preserved and setup did not change existing workspace/project grants. A private operator hit a name-shadowing `TypeError` after the signed helper verified the new app, leaving the lock held. Independent read-only acceptance verified the same candidate, backup, HBA, configuration and counts before unlock; no second migration or restore ran. Superseded legacy local deployments remain stopped with their volumes preserved.
- **Technexus:** the quiesced backup contained 184 tables, 69,976 rows and four files. Initial post-deploy counts were identical. The new image is healthy; normal macOS TLS checks on both hosts passed before and after smoke. Signed-in smoke was 108/110, with two expected empty-workspace instance-admin misses and all 54 browser checks passing; the lock was released.
- **Queued fixes:** #1046–#1048, #1050–#1052 are merged and released. #1053 was split into #1063, #1064 and #1066 (merged); #1054 was replaced by #1065 (merged); #1049 is closed.
- **Storage:** filesystem is active. SeaweedFS is approved as a provider; the S3 configuration draft (#1064, #1066) is saved inactive and no bytes have been cut over.
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

## Release and cutover chain

1. Merge to `main` → `release.yml` builds, Trivy-scans (HIGH/CRITICAL with a fix block publication), generates SBOMs, signs and publishes. Verify with `gh attestation verify oci://ghcr.io/thomasheinthura/taskdesk@<digest> --owner ThomasHeinThura --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml`.
2. **Local SIT upgrade:** use only `deploy/compose.testing.yml`. Set `SIT_COMPOSE_ENV` and `SIT_PRIVATE_DIR` to the private canonical configuration, with `SIT_IMAGE` pinned to the verified release digest and `TASKDESK_IMAGE_TAG` set to its signed release tag. `scripts/deploy.sh local` verifies both the release attestation and cosign signature, requires the initialized canonical database/cache and copied attachment volume, runs migrations, starts the application/proxy and probes readiness; it never imports data or seeds accounts. Run `node scripts/sit/release-smoke.mjs` afterwards. For a clean install, bootstrap and seed on fresh volumes after the separate auth fix is qualified. Preserve the old backup and volumes until acceptance.
3. **Technexus:** Thomas has authorized the clean SIT/UAT replacement after verified backups and confirmed there are no active testers. For the cutover, take a fresh quiesced database, file and private-config backup; verify hashes, counts and a full isolated restore. Record the running digest and its signed release tag. Preserve the host's modified SIT Compose overlay and compare its effective configuration before migration. Stage the verified files directly: `install.sh --env production` would run the production overlay and is not a staging step for this host. Use the signed release helper with `upgrade --target sit` and keep `rollback <digest> <signed-tag> --target sit` ready. Verify health, HTTPS, separate sessions, signed-in smoke and browser journeys on both hosts. Later merges and Technexus deploys need their own approval under AGENTS.md.
4. Any failure stops the cutover. Re-pin the previous verified digest through the matching target and preserve the new diagnostics. If schema incompatibility prevents image rollback, restore the verified backup under the recovery runbook.

## Open after UAT (ordered)

- **Re-audit lows.** Each fix PR (#1033–#1043) lists its remaining low findings under "How it was checked". Known ones:
  - Submission form-field uploads still use the generic signed PUT: bound to key and size, not to a person.
  - #1103 replaced newly issued S3 bucket download links with API-mediated live reach checks for both drivers. Previously issued bucket URLs retain their original five-minute expiry; signed-SIT download and live S3 acceptance remain open.
  - Between `md` and `lg`, the collapsed calendar search does not tell screen readers that a search is active; the current fix is under CI review.
- **Product follow-ups.**
  - Portal read-only Page view.
  - Upload files as Documents entries.
  - Email provider (none for UAT; testers use seeded passwords).
  - Technexus self-registration is open during UAT (A-15, accepted by Thomas).
- **7 Nov follow-ups.** The portal download `Range` length was corrected by #1103; Members `q` filter from person search, agent inbox duplicate request not reproduced, and #1059–#1061 remain.
- **Earlier backlog.** God Mode completeness (A-29–A-34), the rest of L-04, L-05, L-02, L-06, L-07 and L-11. The October drafts #918–#920 were closed on 6 Nov (branches kept).
- **Known flaky tests.**
  - Watch `project-managed-service-persisted` (URL timing) and the API reach-guard hook timeouts under heavy load; rerun before treating either as a regression.
  - Under load, a few web unit files (API-key dialog, role capabilities, command palette, quiet hours) time out and pass alone.
  - Seen once each on 7 Nov and passed on rerun: `src/lib/i18n/index.group.test.ts` ("does nothing special outside the work list") and the `service-calendar` keyboard e2e.

## Working notes

- **Orca child worktrees (Thomas, 9 Nov).** The current coordinator uses separate Orca child worktrees for disjoint PRs. Keep one owner per file, inspect dirty files before staging, and leave subagents' commits, pushes and merges to the coordinator. The 4 Nov no-worktree instruction is superseded for this work.
- **G8.** Regenerate baselines from the CI `playwright-visual` artifact, `<name>-actual.png` → `apps/web/e2e/visual.spec.ts-snapshots/<name>-linux.png`. Look at every image first. `check:visual-scope` allows only `toBeVisible` assertions with literal values.
- **Merge conflicts.** In `i18n/*.json`, merge three-way and keep both sides' keys. For `i18n/schema.json`, `pairs.json` and `openapi.json`, take main's copy and regenerate it (`pnpm i18n:schema`, `node scripts/ci/refresh-contrast-manifest.mjs --write` + biome format, `pnpm openapi:write`).
- **check:env.** It rejects test-only environment reads; write evidence screenshots with `test.info().outputPath`.
- **Workflow edits.** They need Thomas's approval (AGENTS.md).

## Never

- Touch the live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870.
- Weaken, skip or exempt a check, or change budgets, thresholds or calibration. G11 stays report-only.
- Write hosts, keys, credentials, cookies or database URLs into docs, logs or PRs.
- Remove a container except by exact id; never prune.
- Replace SIT/UAT data only under Thomas's current clean-start authorization, after a fresh verified backup and isolated restore. Preserve the old stack and its recovery copy; never use #1089's existing-data rewrite as an implicit part of this reset.

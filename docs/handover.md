# Handover — updated 8 November 2026

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md) first. Thomas's current instructions override everything here.

## Who works on version 2

From 4 Nov Thomas hands version 2 back to **Codex**. Codex owns the release chain and works in the main checkout without creating worktrees. Model tiers and review rules are in AGENTS.md. On 6–7 Nov Claude implemented and released #1062–#1074 at Thomas's direction (see [status](status.md)).

## Goal

**UAT is live** on the Technexus hosts (launched 6 Nov 2026). Current work: the 8 Nov audit rows A8-1…A8-12 and C8-1…C8-6 in the [roadmap](roadmap.md); G11 must pass (Thomas, 8 Nov). Thomas does the final human verification with the credential files on his Mac (`~/.taskdesk/sit-credentials.json` for local SIT, `~/.taskdesk/uat-credentials-technexus.json` for Technexus). They never go into docs, logs or PRs.

## State now

- **7 Nov, running versions:** local SIT (compose project `taskdesk-codex-testing`) and Technexus both run `main` 1f9d94910 (signed, attested). Technexus signed-in smoke 108/110, with the two expected instance-admin misses. Details in [status](status.md).
- **5 Nov release:** `e08c7063ae9a384252066407193662bca8740c24` is accepted on local SIT and Technexus, with signed index `sha256:d34875df206d7c0b3acad20d8ee37911e740fc093df077aa120f4d776c931989`. Release run 41989194302 passed both jobs; source provenance and cosign signature were verified. Release-path fixes #1055 and #1057 shipped; #1056 is closed. This does not complete fresh-customer installation acceptance.
- **Local SIT:** 68/68 smoke checks passed across six roles and both HTTPS hosts; journal 217 and eight attachment hashes were verified. The quiesced backup contained 184 tables and 48,279 rows. A new QA workspace, project and lead/viewer accounts were created through product APIs; the original four credential entries were preserved and setup did not change existing workspace/project grants. A private operator hit a name-shadowing `TypeError` after the signed helper verified the new app, leaving the lock held. Independent read-only acceptance verified the same candidate, backup, HBA, configuration and counts before unlock; no second migration or restore ran. Superseded legacy local deployments remain stopped with their volumes preserved.
- **Technexus:** the quiesced backup contained 184 tables, 69,976 rows and four files. Initial post-deploy counts were identical. The new image is healthy; normal macOS TLS checks on both hosts passed before and after smoke. Signed-in smoke was 108/110, with two expected empty-workspace instance-admin misses and all 54 browser checks passing; the lock was released.
- **Queued fixes:** #1046–#1048, #1050–#1052 are merged and released. #1053 was split into #1063, #1064 and #1066 (merged); #1054 was replaced by #1065 (merged); #1049 is closed.
- **Storage:** filesystem is active. SeaweedFS is approved as a provider; the S3 configuration draft (#1064, #1066) is saved inactive and no bytes have been cut over.
- **Audit scope:** 30 Technexus owner desktop-dark rows were reviewed observationally and 24 screenshots independently inspected: 17 observations, four redirects, two design observations, one runtime observation and six fixture blocks. Focused security checks resolved the observed 403 as expected and isolated the Inbox result to a Chrome focus boundary; neither confirmed a medium bug. Open findings: agent not-found heading/recovery (#1059), keyboard-clear focus (#1060) and mobile Calendar toolbar overflow (#1061). The latter two predate #1046. The 154-row route inventory is statically reconciled, not fully browser-verified; calendar source checks do not complete it.
- **Dependencies:** the audit reports three advisories, comprising one low and three moderate instances, with no high or critical findings. Production low `deepmerge` remains #909; development upgrade #1058 awaits approval for new transitive packages. No dependency was changed.
- UAT items U-1 to U-15 in the [roadmap](roadmap.md) are live, except U-10 (Thomas's sign-off) and the role checks, which are pending:
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

## State at the end of the 8 Nov fix round (Claude, evening)

Read this first; it replaces the older "State now" for anything about open work. Rules are in [AGENTS.md](../AGENTS.md); the ordered plan is the roadmap rows A8-*, C8-1…C8-15 and UX-0…UX-16; evidence is in `docs/report/` (`audit-and-plan-2026-11-08-claude.md`, `audit-round-2-2026-11-08.md`, `ux-critique-2026-11-08.md`, `ux-review-localhost-2026-11-08.md`).

**Merged this round:** #1078 IPv6 private-address guard, #1079 dead Kaneo code, #1080 board drag render, #1081 archive/column/rule permissions, #1082 `deploy.sh sit` no longer re-seeds, #1083 drag-bench listener order, #1084 not-found screens and console errors, #1085 work-list LCP (two commits). **Nothing from this round is deployed:** UAT and local SIT still run the 7 Nov release.

**Open PRs, each on its own branch (no worktrees):** #1077 docs (this file, roadmap rows, reports); #1086 shared PageHeader/PageContainer/FeatureOff (four G8 baselines already regenerated, see below); #1087 portal polish; #1088 settings and request types; #1089 demo-data seeder and light-theme capture; #1090 sheet sidebar below 1024 px. All are behind `main`: update with `gh pr update-branch N`, or merge main locally when it conflicts. The only recurring conflict is the generated `packages/ui/src/styles/pairs.json`: take either side, run `node scripts/ci/refresh-contrast-manifest.mjs --write` (add `--acknowledge-removals <json array file>` when it lists removals), `pnpm exec biome format --write` the file, then `pnpm check:tokens`.

**Merge discipline:** `main` requires up-to-date branches, so every merge puts the others behind and restarts a ~35 min CI. Merge one PR at a time, security and permission PRs first, docs last. G11 is a non-required job and fails on LCP only; every other required check must be green.

**Still to do, in order:**
1. **Fix #1087, #1088** (CI failures on their last full runs): #1087's portal a11y spec was already repaired and pushed (079e02c98); #1088 has failing e2e (`e2e - protected-route redirect`) and G8 jobs: read the failing spec names from the last completed "CI - full" run of the branch, adapt the specs to the intended UI change, then regenerate the G8 baselines.
2. **G8 baselines:** do not regenerate locally (the pinned container cannot mount `~/Documents`). Download the `playwright-visual` artifact of the PR's last completed full run (`gh run download <run> -n playwright-visual -D <dir>`), look at every `*-actual.png`, copy approved ones to `apps/web/e2e/visual.spec.ts-snapshots/<name>-linux.png`, commit (subject lowercase, body lines ≤ 100 characters). `check:visual-scope` forbids anything but API fixtures before navigation, so never freeze the browser clock; avoid relative times.
3. **G11 work-list LCP (C8-6):** CI median 3064 → 2768 → 2619 ms normalised (budget 2500). The LCP element is the read-only list preview row. Next lead: the 38 KB route closure that gates first render (~5 ms per KB on CI), then the 232 KB entry graph. Never change budgets, calibration or the harness; the real bench refuses to run on this Mac (calibration factor outside range), so CI is the measurement.
4. **UX rows UX-2, UX-3, UX-4, UX-5, UX-11…UX-16** and **C8-1, C8-7…C8-15** from the roadmap. Tablet and phone problems, tables that scroll sideways, the Backlog rebuild, role-aware navigation and denied states are the biggest visible gaps.
5. **After merges:** redeploy local SIT from the signed release (`scripts/deploy.sh local`, see Release chain), run `node scripts/sit/release-smoke.mjs` (options: `--accounts`, `--extra`, `--extra-portal`, `--width`, `--height`, `--scheme light|dark`, `--out`; set `NODE_EXTRA_CA_CERTS=~/.taskdesk/canonical-local-lrplfnl5/proxy/certs/local.crt`) and a Playwright pass at 390, 768 and 1440 px in both themes, then Technexus through the `proxy` SSH host with backup first. Thomas runs the signed-in UAT smoke himself (`pnpm sit:smoke -- --agent <uat agent URL> --portal <uat portal URL> --credentials ~/.taskdesk/uat-credentials-technexus.json`).

**Thomas's standing approvals (8 Nov):** the recommended option for A8-2, A8-8, A8-9, A8-11 and A8-12 (recorded in `design-and-decisions.md`), merges after green required checks and an independent review, Technexus deploys through the release chain. Open decisions for him: SLA and service-calendar settings now stay in the navigation with an Off badge (PR #1086, contract text in `features.md` not yet updated); the demo seeder's `--allow-existing-data` rewrites empty system role placeholders (#1089); wire or delete the orphan project-move planner (SIMP-6); remove env-based Google and Discord sign-in (SIMP-7).

**Review rule used this round:** security, permission and auth changes got an independent Opus review (read-only, from git objects, no checkout) and a re-review after fixes: #1078, #1081, #1084, #1089. Do the same for anything touching auth, permissions, tenant isolation, deletion, import or API keys.

**Environment:** local SIT (`taskdesk-codex-testing`) is up on the old release with Thomas's data: never reseed or reset it. A separate review stack `taskdesk-review` (project name, `review.localhost:18443`) is running a seeded build of the integrated UX branches for browser review; its exact container ids and removal commands are in the agent report of the browser review (ask Thomas or run `docker ps --filter name=taskdesk-review`). Remove it by exact id when done. macOS `/tmp` holds its secrets and `/tmp/claude-501/review-shots/` holds 453 screenshots; both disappear on reboot.

**Gotchas learned:** `git switch -c X origin/main` can create the branch but fail to switch; run `git switch X` again. Sandboxed shells cannot bind ports or run Chromium (`check:tokens`, `check:route-policy`, Playwright need the sandbox off). `pnpm check:route-policy` exits 0 even when its permission tests fail to start: read its output (row C8-15). `check:i18n` exits 1 on `main` (vi-VN plural keys): do not make it worse. Local `pnpm lint:ci` fails on ignored folders (`.vscode`, `backups`, `test-results`); CI is the truth. Release smoke and e2e specs are listed in `docs/testing.md`. Seeders: never run the SIT account seeder; the demo seeder (`apps/api/scripts/seed-demo.mjs --demo`) is for fresh scratch or review databases only.

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
- **7 Nov follow-ups.** `Range` on a registered portal route still answers 206 with the raw file length; Members `q` filter from person search; agent inbox duplicate request not reproduced; #1059–#1061.
- **Earlier backlog.** God Mode completeness (A-29–A-34), the rest of L-04, L-05, L-02, L-06, L-07 and L-11. The October drafts #918–#920 were closed on 6 Nov (branches kept).
- **Known flaky tests.**
  - Watch `project-managed-service-persisted` (URL timing) and the API reach-guard hook timeouts under heavy load; rerun before treating either as a regression.
  - Under load, a few web unit files (API-key dialog, role capabilities, command palette, quiet hours) time out and pass alone.
  - Seen once each on 7 Nov and passed on rerun: `src/lib/i18n/index.group.test.ts` ("does nothing special outside the work list") and the `service-calendar` keyboard e2e.

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

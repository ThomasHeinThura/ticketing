# P0 installer re-run fix — review record

**Reviewed head:** `a0bc2f67dadad83d327c553fc178b5eadb343d2d`

## Background

The `v2.0.0-alpha.3` installer upgrade/rollback proof passed. It also found three problems (evidence: `p0-installer-proof-3-20261010T090655Z`):

1. The first production install wrote `TASKDESK_FILES_HOST=files.<domain>` without checking DNS for it. The re-run then DNS-checked that value and aborted.
2. `container-image.md` misdocumented the `/api/public/health/live` response.
3. The session cookie rename forces users to sign in again after an upgrade or rollback.

## The fix

- The files host is DNS-checked only when it is routed: with `--profile s3`, or when it is given explicitly with `--files-host`.
- The installer pin is refreshed.
- The docs are corrected and a runbook note is added.

## Contexts

- **Implementation:** Claude Sonnet `ab1af3fe64352f252`.
- **Ordinary review:** Claude Sonnet `a013334bd0ab5a0a2`, APPROVE.
- **Security review:** Claude Opus 5.5 `a1e45876bb7c68ec9`, PASS. It is Sol-tier under Thomas's routing and is not a GPT-6 Sol review.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent a013334bd0ab5a0a2; model claude-sonnet-5-5; role independent ordinary review; candidate a0bc2f67dadad83d327c553fc178b5eadb343d2d; sha256 0fdbd885e8d23f7495da2c1ea308f692ce0c959e805580539fd5f7fc848e035f) -->
# Independent ordinary review: claude/p0-installer-rerun-fix

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh reviewer subagent context; did not author or direct the change)
**Reviewed head:** a0bc2f67dadad83d327c553fc178b5eadb343d2d
Parent verified: 954eb84094e009658943af1e294d3b8a48d17f69. Worktree clean before and after my runs (I temporarily swapped install.sh for the mutation test and restored it; sha256 re-verified).

## Verdict: APPROVE (no blocking findings). Security-scope Sol review is still required: scripts/ci/** matches the test file.

## 1. Contract
- Files host is routed only by the `seaweedfs` service, which compose.prod.yml says is "Only started with --profile s3" (lines ~90-100). configuration-reference.md:122 says TASKDESK_FILES_HOST "matters only when the S3 profile is enabled". The fix matches that contract.
- New rule: `FILES_HOST` is DNS-checked only if non-empty and (PROFILE_S3 or FILES_HOST_SET). The old second line (`files.${DOMAIN}` fallback) was redundant, because install.sh:77 already sets FILES_HOST when PROFILE_S3. Removing it is safe.
- Cases:
  - First install, no S3: not checked. Correct (no router exists).
  - Re-run, no flags: the host persisted in .env at :299 is not checked. Correct. This is the reported bug.
  - Re-run of an S3 install without `--profile s3`: PROFILE_S3 is flag-only in install.sh:32 and scripts/deploy.sh:88; neither persists it. deploy.sh then does not add `--profile s3` (:107) or seaweedfs deps (:346), so the files router is not part of that deploy and a DNS check would not gate anything real. Skipping it is consistent. The pre-existing hazard is that the operator must repeat `--profile s3` on every re-run; that is not a regression, and the new doc text states it.
  - `--files-host` given on a previous run but not this one: it is not checked on this run (the persisted value is not trusted as intent). If the install is S3 and `--profile s3` is passed, it is checked. If S3 is not passed, the host is unrouted anyway. Acceptable.
  - Local mode: the DNS block is production-only (`if MODE == production`); local mode is unchanged. Dry-run in local prints no preflight line.
- No DNS check that is actually required is skipped. I found no case where the files host is routed without PROFILE_S3 in this flow.
- Dry-run vs real, checked by running with a stubbed `uname` (macOS host) against an .env with DOMAIN and a persisted files host:
  - no flags: lists ticket + portal only
  - `--profile s3`: adds files.example.test
  - `--files-host f.example.test`: adds f.example.test
  - first install: lists ticket + portal only
  Dry-run matches the real dns_hosts logic (same predicate).

## 2. Tests
- `node --test scripts/ci/install.test.mjs`: tests 48, pass 48, fail 0, skipped 0 (about 44s).
- Mutation (HEAD~1 install.sh restored): the new first-install/re-run test FAILS, and the sha-pin test FAILS (expected, because the file changed). The new test is non-vacuous. The install.sh fix was then restored.
- The second new test (S3 profile and explicit --files-host still fail with DNS error) passes on the old code too. It is a guard against over-correction, not a regression test. Not vacuous: it asserts non-zero status and the exact DNS message with the getent stub honouring FAKE_DNS_MISSING.
- sha256 pin in one-line-install.md:118 = ab4e319e2ea267ebab4b7c63f61944a98c86d0544f77e49b9dce86a19891fb4c = `sha256sum install.sh`. Equal.

## 3. Static checks
- `bash -n install.sh`: OK.
- shellcheck: not installed and offline; not run.
- biome check scripts/ci/install.test.mjs (main repo binary): clean.

## 4. Docs
- container-image.md: `/api/public/health/live` returns only `{"status":"ok"}`; matches apps/api/src/index.ts:~652. No `version, sha` text remains in docs (grep). Correct.
- Cookie name `__Host-tdk_agent_session` matches apps/api/src/auth.ts:990, with Secure attribute and host-only (`__Host-` prefix). Introduced by #602 (b64f8062). Accurate.
- Runbook note: both directions (upgrade and rollback) described correctly. Sessions don't carry across the rename either way. It sits in the rollback section.

## 5. Scope
5 files changed: install.sh (3 lines), install.test.mjs, one-line-install.md, container-image.md, runbook.md. No other changes and no new feature. The hash refresh is required by the existing test.

## Findings
- NON-BLOCKING: The runbook note covers only the agent cookie. auth.ts:991 also renames the portal cookie to `__Host-tdk_portal_session` (git: 9da6f5c7, earlier than the agent cookie rename); portal users are affected too. Consider "agent and portal session cookies".
- NON-BLOCKING: one-line-install.md line 69-71 has an overlong, awkward line (reflow). Cosmetic.
- NON-BLOCKING / pre-existing: PROFILE_S3 is not persisted, so an S3 install re-run without `--profile s3` stops being treated as an S3 deployment (the files router/seaweedfs are not part of that deploy). Documented now, not fixed here; out of scope.
- NON-BLOCKING: shellcheck was not run (unavailable).

## Commands run
- `git rev-parse HEAD HEAD~1; git status --short; git diff --stat/diff HEAD~1`
- `sed`/`grep` over install.sh, scripts/deploy.sh, deploy/compose.prod.yml, configuration-reference.md, apps/api/src/index.ts, apps/api/src/auth.ts
- `bash -n install.sh`; `which shellcheck` (not found)
- `sha256sum install.sh`; grep of the pin in one-line-install.md
- `node --test scripts/ci/install.test.mjs` (48/48)
- Mutation: install.sh swapped to `git show HEAD~1:install.sh`, ran tests (2 fail as expected), restored; sha re-checked
- `/Users/heinthura/Documents/Workfolder/Development/Ticketing.v2/node_modules/.bin/biome check scripts/ci/install.test.mjs`
- `bash install.sh --env production --dir <scratch> --dry-run [--profile s3 | --files-host ...]` with stubbed uname
- `git log -S` on auth.ts for the cookie names
<!-- END REPORT (sha256 0fdbd885e8d23f7495da2c1ea308f692ce0c959e805580539fd5f7fc848e035f) -->

<!-- BEGIN REPORT (agent a1e45876bb7c68ec9; model claude-opus-5-5; role independent Sol-tier security review; candidate a0bc2f67dadad83d327c553fc178b5eadb343d2d; sha256 f26653961e0703bd64a2fe828513e33d6d4e9d9c39029b29c888a72a2a9874ab) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:opus-sol-p0fix-a0bc2f67 (fresh subagent context spawned from orchestrator session 3a9e9ce4-8409-47d4-b1be-1f1544697e70; no harness-issued agent id was visible inside this context)
**Reviewed head:** a0bc2f67dadad83d327c553fc178b5eadb343d2d

**Verdict: PASS — no blocking findings.** Clear to merge from the security-tier perspective, subject to the other required gates (ordinary review, CI) being recorded at this exact SHA.

## Scope

- Worktree: /private/tmp/claude-501/p0fix, branch `claude/p0-installer-rerun-fix`.
- Comparison base: parent `954eb84094e009658943af1e294d3b8a48d17f69` (main). Verified with `git rev-parse HEAD HEAD^`.
- Diff: 5 files, +73/-8.
  - `install.sh` (2 hunks: line 97 dry-run text, lines 126-127 DNS preflight).
  - `scripts/ci/install.test.mjs` (fake `getent` honours `FAKE_DNS_MISSING`; 2 new tests).
  - `docs/05-operations/one-line-install.md` (behaviour text and the sha256 pin).
  - `docs/05-operations/container-image.md` (liveness response).
  - `docs/05-operations/runbook.md` (cookie-rename re-sign-in note).
- Evidence read: `~/.codex/taskdesk-evidence/2026-10-10/p0-installer-proof-3-20261010T090655Z/result.json`.
  - FND-1 describes the defect exactly: the first install writes `TASKDESK_FILES_HOST=files.<domain>`, and the next run aborts on DNS.
  - FND-2 and FND-3 match the two doc changes.

## Findings

### BLOCKING

None.

### NON-BLOCKING

**N1. Not a security defect, and the cause was found: one test failure in the shared worktree came from another process.** The first `node --test scripts/ci/install.test.mjs` run in /private/tmp/claude-501/p0fix failed one assertion. The failure was `install.sh: line 138: syntax error near unexpected token '('`, raised in the new first-install test.
- The `install.sh` mtime was 16:59 local, but the commit is from 16:33. Another process (probably a concurrent reviewer's mutation run) briefly modified the shared worktree's `install.sh`.
- By the time I checked, the file had been restored. It hashes to `ab4e319e…fb4c` and `git status` is clean.
- An immediate re-run in the same worktree passed 48/48. A run on a private `git archive HEAD` copy also passed 48/48.
- Both `/bin/bash -n install.sh` (bash 3.2.57) and the HEAD^ version parse cleanly.
- Recommendation: concurrent reviewers should not mutate a shared worktree. Use a private copy.

**N2. Existing behaviour that this change makes slightly more relevant: `--profile s3` is not remembered.** An S3 install that is re-run without `--profile s3`:
- now skips the files-host DNS check. Before, the check ran on the persisted value.
- still runs `deploy.sh production` without the profile. `compose.yml:171-173` puts `seaweedfs` under `profiles: [s3]`, and `scripts/deploy.sh:107` adds the profile only when the flag is given.

Compose `up` without the profile does not stop or remove an already-running profile container; deploy.sh uses no `--remove-orphans`. So the effect on the stack is the same before and after this change. The only difference is a skipped DNS check for a router this run does not create or change.

This is not unsafe. The doc now tells operators to repeat the flag (`one-line-install.md:69-71`). A follow-up could persist the profile, but this PR does not need it.

**N3. Existing behaviour, outside this diff: a stale files host after a domain change.** On a re-run with a new `--domain`:
- `AGENT_HOST` and `PORTAL_HOST` are reset (`install.sh:62,64`), but `FILES_HOST` is not (`install.sh:65`).
- Line 299 then rewrites `TASKDESK_FILES_HOST` with the old domain's files host.

With this change that stale value is not DNS-checked unless the run passes `--profile s3`, in which case it still is (`install.sh:127`). The stale value is still DNS-name validated (`install.sh:67`). This is a correctness issue, not a security one. Suggested follow-up: reset `FILES_HOST` when `DOMAIN_SET` and it was not given explicitly, the same way the other two hosts are reset.

**N4. Docs inconsistency, outside this diff.** `docs/05-operations/deployment.md:66` shows `curl -fsSL https://get.taskdesk.dev | bash`, while `one-line-install.md:11` uses `/install.sh`. Publishing `get.taskdesk.dev` is P7 work.

## Adversarial focus: results

### 1. Can the narrowed DNS preflight let a production install reach a broken or unsafe state?

- **Routing and ACME.** The only files router is on `seaweedfs` (`deploy/compose.prod.yml:95-105`), and that service exists only under `profiles: [s3]` (`compose.yml:173`).
  - Without `--profile s3`, no `Host(files.*)` router exists and Traefik requests no ACME certificate for it, so the change creates no rate-limit exposure.
  - With `--profile s3`, `FILES_HOST` is defaulted (`install.sh:77`) and DNS-checked (`install.sh:127`).
  - I found no `HostRegexp` or catch-all router in `deploy/` or `compose.yml`. A `files.*` Host header without the profile matches no router and gets Traefik's 404. It does not reach the API.
- **S3 re-run without the flag.** See N2. The stack outcome is unchanged and no new router or certificate is requested.
- **Explicit `--files-host` without the profile.** It is still DNS-checked (conservative), and documented as such.
- **Dry-run line (`install.sh:97`).** I checked the `$( ((…)) && printf … )` construct under bash 3.2 for all three cases (no flag, `--profile s3`, `--files-host`). The output was correct each time.

### 2. Installer supply-chain integrity

- The diff does not touch cosign verification, the checksum check, `RELEASE_BASE`, `STABLE_URL`, the archive path or link checks, `--skip-verify`, or `set -Eeuo pipefail`.
- `shasum -a 256 install.sh` gives `ab4e319e2ea267ebab4b7c63f61944a98c86d0544f77e49b9dce86a19891fb4c`, which equals the new pin at `one-line-install.md:118`.
- `git grep` across the tree, excluding `docs/07-planning` and reviews, found that pin only there. The old pin `cd4078e8…` appears nowhere outside planning and evidence.
- The test `published source installer hash in the runbook matches install.sh byte-for-byte` (`install.test.mjs:977`) enforces this.
- `release.yml` does not package or publish `install.sh`. Hosting `get.taskdesk.dev` is P7. So a release built from this main cannot serve an `install.sh` whose pin mismatches. The one pin is mechanically tied to the file by CI.

### 3. Input handling

- Persisted `TASKDESK_FILES_HOST` is still read through `read_env_value`, which rejects a symlinked `.env` (`install.sh:53-57`). It is then validated by `valid_dns_name` (`install.sh:67`) before any use. That code is unchanged and runs before the DNS block.
- I confirmed it live: `.env` with `TASKDESK_FILES_HOST=bad;host` gave `error: host overrides must be valid DNS names`.
- `dns_hosts` is a quoted array, and `resolve_host` passes `"$1"`, so there is no word-splitting or injection path.

### 4. Tests and mutation check

The installer suite passed 48/48 on a private copy of HEAD. Both new tests passed. I applied five mutants to the DNS line `install.sh:127` in a private copy and ran the two new tests each time:

| Mutant | Result |
| --- | --- |
| M1 restore the pre-fix logic (`[[ -z "$FILES_HOST" ]] \|\| dns_hosts+=…`) | killed: re-run test fails |
| M2 condition only `PROFILE_S3` | killed: explicit `--files-host` case fails |
| M3 condition only `FILES_HOST_SET` | killed: `--profile s3` case fails |
| M4 never check the files host | killed |
| M5 always check `files.${DOMAIN}` | killed: both tests fail |

The tests are not vacuous:
- M1 shows the re-run test really exercises the persisted-`.env` path.
- M2 and M3 show each branch of the OR is pinned independently.
- The fake `getent` is the binary actually used (PATH-first fake bin).
- Any byte change to `install.sh` also fails the pin test.

## Commands run

```
git -C /private/tmp/claude-501/p0fix rev-parse HEAD HEAD^ ; git log --oneline -3 ; git diff HEAD^ HEAD
grep -n FILES_HOST|PROFILE_S3|DOMAIN install.sh ; sed -n 40-140,290-305p install.sh
git grep -nE "cd4078e8|ab4e319e|[0-9a-f]{64}" ; shasum -a 256 install.sh
grep -n install .github/workflows/release.yml ; git grep get.taskdesk.dev
sed -n 80-105p deploy/compose.prod.yml ; grep -n profiles compose.yml ; grep -n profile scripts/deploy.sh
grep HostRegexp|rule= deploy compose.yml
/bin/bash -n install.sh ; /bin/bash -n <(git show HEAD^:install.sh)
node --test scripts/ci/install.test.mjs   (shared worktree: run 1 had 1 failure from another process, see N1; run 2 passed 48/48)
git archive HEAD | tar -x -C <scratchpad>/opusrev ; node --test scripts/ci/install.test.mjs   (48/48)
mutants M1-M5 on a private copy, each: node --test --test-name-pattern="files DNS record" scripts/ci/install.test.mjs
dry-run under /bin/bash 3.2 with a fake Linux uname: no flag / --profile s3 / --files-host; .env with an invalid files host
cat <evidence>/result.json ; grep health/live apps/api/src/index.ts ; grep __Host-tdk_agent_session apps/api/src
```

Node v26.10.0 (/opt/homebrew/bin/node); bash 3.2.57 (macOS /bin/bash).

## Residual risk

- The S3 profile is still not persisted (N2). An operator who forgets the flag on re-run skips the files-host check. Because no router changes, there is no security impact.
- The files host goes stale after a domain change (N3). This is existing behaviour, and the value stays DNS-validated.
- Tests use faked `getent`, `docker` and `uname`. A real Linux VM re-run was not repeated on this exact head. The evidence bundle covers the pre-fix head `b704f70`.

## Not checked

- GitHub PR state, required checks and the CI run at this SHA. `gh` failed with a TLS certificate error in the sandbox.
- A real Ubuntu VM install and re-run of this head. Traefik ACME behaviour was checked by configuration reading only, with no live issuance.
- `deploy.sh` run directly with `--profile s3` (it has no DNS preflight of its own). This is existing behaviour and outside this diff.
- The rest of the test suite beyond `scripts/ci/install.test.mjs`.
- The runbook cookie note against the actual behaviour of the #602 cookie rename. I only confirmed the cookie name in `apps/api/src/auth.ts:990` and `utils/csrf-protection.ts:9`.
<!-- END REPORT (sha256 f26653961e0703bd64a2fe828513e33d6d4e9d9c39029b29c888a72a2a9874ab) -->

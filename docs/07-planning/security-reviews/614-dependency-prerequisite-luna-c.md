# PR #614 — authentic independent GPT-6 Luna review C

Transported verbatim by the orchestrator; model explicitly selected as `gpt-6-luna`, `fork_turns=none`. Prerequisite author was reviewer B in a separate author role; these contexts did not author or fix the prerequisite.

---

# Independent ordinary review — dependency-audit prerequisite

- **Candidate:** `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`
- **Base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Model/context:** GPT-6 Luna per the orchestration-selected reviewer context; fresh and independent. I did not author, direct, or remediate this candidate. No runtime introspection is claimed.
- **Scope:** Read the full five-file diff, `/tmp/taskdesk-audit-prerequisite-report.md`, dependency manifests, lockfile resolutions, workspace override invariant, CI audit command, and the two MCP SDK consumers. Verified advisory ranges/fixed versions from GitHub Advisory Database and release sources, and package license/dependency metadata from the npm registry. No source edits.
- **Checks actually performed:** Confirmed checkout HEAD and base; reviewed exact lockfile diff and resolved graph entries; verified npm registry metadata and the SDK's 1.30.0/1.31.0 dependency lists match; inspected actual imports in `apps/api` and `packages/mcp`; ran `git diff --check` (clean). I did not rerun the author-reported tests, build, audit, or image build, and did not boot the image; those results remain claims from the supplied report, while runtime acceptance is separately pending.

## Verdict

**CLEAR, with one non-blocking documentation observation.** The patch is a narrow update of four already-present vulnerable packages, pins only those existing packages to the identified fixed versions, and adds no package, scanner suppression, threshold change, or security-policy exception. The lockfile resolves the intended versions, and the two direct MCP SDK consumers are aligned at 1.31.0.

## Findings

### Blocking

None found.

### Non-blocking

The unchanged explanatory note in `scripts/ci/test-all.mjs` says the audit is “clean at EVERY severity,” while its actual command is `pnpm audit --audit-level=high`. The supplied report says that command exits zero with one low KaTeX advisory. The executable gate and documented threshold remain unchanged, and this candidate accurately records the low advisory as residual; the note is stale/inexact guidance and does not block this bounded fix.

## Review details

- The four fixed releases match the advisories: `proxy-addr` 2.0.8 fixes GHSA-jqcg-44mw-7w3h (critical); `source-map-js` 1.2.2 fixes GHSA-68fv-2mgg-jv7q (high); `prosemirror-view` 1.42.3 fixes GHSA-c8x8-7fp4-3x9w (high); and `@modelcontextprotocol/sdk` 1.31.0 is the first patched 1.x release for GHSA-6qxp-vccf-f47h (high).
- Registry metadata confirms unchanged licenses: proxy-addr MIT, source-map-js BSD-3-Clause, prosemirror-view MIT, and MCP SDK MIT. SDK 1.31.0 retains the same dependencies, peer dependencies, and Node engine range as 1.30.0. Its release notes add an issuer field to stored OAuth data, but the workspace consumers here use `McpServer`, `StdioServerTransport`, and types; no OAuth client or token-storage API appears in either consumer. The reported focused tests/builds cover the MCP package and API/web dependents.
- `prosemirror-view` 1.42.3 declares `prosemirror-model: ^1.25.8`, so the retained 1.25.11 lock resolution satisfies it. The other affected graph entries retain their prior dependency families; the lock changes resolve only the four intended package versions and their snapshots.
- The separate KaTeX 0.16.47 GHSA-238p-pmpm-9mq7 advisory is officially rated low and fixed in 0.18.2. The decision log and report leave it visible as residual. The repository command remains `pnpm audit --audit-level=high`; the candidate does not suppress the advisory or alter that threshold.
- The author report lists frozen install, audit, override check, MCP/editor tests, API/MCP builds and typecheck, web typecheck/build, Docker build, and clean diff. Those were not independently rerun in this review. The report explicitly leaves container boot/health and runtime acceptance pending, which must still be completed before merge under the existing deployment gate.

## Primary sources checked

- [GitHub advisory: proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [GitHub advisory: source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [GitHub advisory: prosemirror-view](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w)
- [GitHub advisory: MCP TypeScript SDK](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
- [GitHub advisory: KaTeX residual](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
- [MCP SDK 1.31.0 release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0)
- npm registry metadata for each exact published package version (fetched directly during review).

---

# Independent ordinary review — dependency-audit prerequisite

- **Candidate:** `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`
- **Base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Model/context:** GPT-6 Luna per the orchestration-selected reviewer context; fresh and independent. I did not author, direct, or remediate this candidate. No runtime introspection is claimed.
- **Scope:** Read the full five-file diff, `/tmp/taskdesk-audit-prerequisite-report.md`, dependency manifests, lockfile resolutions, workspace override invariant, CI audit command, and the two MCP SDK consumers. Verified advisory ranges/fixed versions from GitHub Advisory Database and release sources, and package license/dependency metadata from the npm registry. No source edits.
- **Checks actually performed:** Confirmed checkout HEAD and base; reviewed exact lockfile diff and resolved graph entries; verified npm registry metadata and the SDK's 1.30.0/1.31.0 dependency lists match; inspected actual imports in `apps/api` and `packages/mcp`; ran `git diff --check` (clean). I did not rerun the author-reported tests, build, audit, or image build, and did not boot the image; those results remain claims from the supplied report, while runtime acceptance is separately pending.

## Verdict

**CLEAR, with one non-blocking documentation observation.** The patch is a narrow update of four already-present vulnerable packages, pins only those existing packages to the identified fixed versions, and adds no package, scanner suppression, threshold change, or security-policy exception. The lockfile resolves the intended versions, and the two direct MCP SDK consumers are aligned at 1.31.0.

## Findings

### Blocking

None found.

### Non-blocking

The unchanged explanatory note in `scripts/ci/test-all.mjs` says the audit is “clean at EVERY severity,” while its actual command is `pnpm audit --audit-level=high`. The supplied report says that command exits zero with one low KaTeX advisory. The executable gate and documented threshold remain unchanged, and this candidate accurately records the low advisory as residual; the note is stale/inexact guidance and does not block this bounded fix.

## Review details

- The four fixed releases match the advisories: `proxy-addr` 2.0.8 fixes GHSA-jqcg-44mw-7w3h (critical); `source-map-js` 1.2.2 fixes GHSA-68fv-2mgg-jv7q (high); `prosemirror-view` 1.42.3 fixes GHSA-c8x8-7fp4-3x9w (high); and `@modelcontextprotocol/sdk` 1.31.0 is the first patched 1.x release for GHSA-6qxp-vccf-f47h (high).
- Registry metadata confirms unchanged licenses: proxy-addr MIT, source-map-js BSD-3-Clause, prosemirror-view MIT, and MCP SDK MIT. SDK 1.31.0 retains the same dependencies, peer dependencies, and Node engine range as 1.30.0. Its release notes add an issuer field to stored OAuth data, but the workspace consumers here use `McpServer`, `StdioServerTransport`, and types; no OAuth client or token-storage API appears in either consumer. The reported focused tests/builds cover the MCP package and API/web dependents.
- `prosemirror-view` 1.42.3 declares `prosemirror-model: ^1.25.8`, so the retained 1.25.11 lock resolution satisfies it. The other affected graph entries retain their prior dependency families; the lock changes resolve only the four intended package versions and their snapshots.
- The separate KaTeX 0.16.47 GHSA-238p-pmpm-9mq7 advisory is officially rated low and fixed in 0.18.2. The decision log and report leave it visible as residual. The repository command remains `pnpm audit --audit-level=high`; the candidate does not suppress the advisory or alter that threshold.
- The author report lists frozen install, audit, override check, MCP/editor tests, API/MCP builds and typecheck, web typecheck/build, Docker build, and clean diff. Those were not independently rerun in this review. The report explicitly leaves container boot/health and runtime acceptance pending, which must still be completed before merge under the existing deployment gate.

## Primary sources checked

- [GitHub advisory: proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [GitHub advisory: source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [GitHub advisory: prosemirror-view](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w)
- [GitHub advisory: MCP TypeScript SDK](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
- [GitHub advisory: KaTeX residual](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
- [MCP SDK 1.31.0 release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0)
- npm registry metadata for each exact published package version (fetched directly during review).

## Audit-threshold comment clarification delta

- **Candidate:** `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a`
- **Delta base:** `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`
- **Model/context:** GPT-6 Luna per the orchestration-selected reviewer context; fresh and independent. I did not author, direct, or remediate the candidate. No runtime introspection is claimed.
- **Scope:** Read-only review of the `.github/workflows/ci-fast.yml` comment, `scripts/ci/test-all.mjs` manifest note, and decision-log clarification. The full dependency source review above remains applicable; this delta changes no package manifest or lockfile.
- **Checks actually performed:** Confirmed exact candidate and three-file delta; inspected both unchanged audit invocations (`pnpm audit --audit-level=high`); confirmed the manifest `note` is only printed to stdout and does not control execution; ran `git diff --check` (clean); ran `pnpm --version` (10.32.1) and `pnpm audit --audit-level=high` on this candidate (exit 0, output `1 vulnerabilities found / Severity: 1 low`). No tests/build/image/runtime checks were run for this comment-only delta.

### Delta verdict

**CLEAR** for exact candidate `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a`, retaining the full dependency review above. The comments now state the unchanged threshold accurately: high and critical findings fail, while lower-severity findings remain reported and do not fail. This matches the observed pnpm 10.32.1 invocation: the low KaTeX finding is visible and the command exits zero. Neither the workflow command, CI step structure, manifest command array, nor any gate pass/fail logic changed. The decision record accurately distinguishes this descriptive correction from dependency remediation.

**Blocking findings:** None.

**Non-blocking findings:** None; the stale wording noted in the prior review is resolved.

This delta changes a CI workflow file, which remains within the repository's security-review path. This ordinary review does not substitute for the separately required independent GPT-6 Sol review. Existing image/runtime evidence remains bound to its actual build source; I did not inspect or alter that artifact.

## Primary reference for the clarified behavior

[pnpm 10 audit CLI documentation](https://www.pnpm.cn/en/10.x/cli/audit) describes `--audit-level` behavior; I independently confirmed the repository's pinned pnpm 10.32.1 behavior with the command output recorded above.

# PR #614 — authentic independent GPT-6 Luna review A

Transported verbatim by the orchestrator; model explicitly selected as `gpt-6-luna`, `fork_turns=none`. Prerequisite author was reviewer B in a separate author role; these contexts did not author or fix the prerequisite.

---

# Independent ordinary review A — dependency-audit prerequisite

- **Exact candidate:** `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`
- **Base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Independence/model:** Fresh independent GPT-6 Luna review context for this bounded dependency patch; did not author, direct, or remediate it.
- **Files reviewed:** Complete five-file diff: `apps/api/package.json`, `packages/mcp/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/07-planning/decision-log.md`. Cross-checked unchanged audit workflow and CI threshold, all current SDK consumers, and historical supply-chain notes.
- **Checks actually run:** `git diff --check` passed. `pnpm audit --audit-level=high` on this exact checkout exited 0 and reported one low advisory. `pnpm audit --json` reports 1,419 dependencies, zero high and zero critical, with only KaTeX 0.16.47 / GHSA-238p-pmpm-9mq7 remaining. Read the pre-patch `/tmp/taskdesk-control-plane-audit.json`, which has 1,419 dependencies and the original five findings (one critical, three high, one low). Queried official npm metadata for patched package versions, licenses, engines and SDK peer ranges. Read the official GitHub advisories for all four patched findings and the KaTeX residual. I did not run product tests/build or image boot; those are being checked in another lane and are not represented here.

## Findings

**Blocking — stale absolute audit claim in the unchanged CI workflow.** `.github/workflows/ci-fast.yml` still says the `pnpm audit` check reports “no known vulnerabilities at EVERY severity, not only at high.” The candidate intentionally retains one low-severity KaTeX advisory, so that statement becomes false on this graph even though the unchanged `--audit-level=high` check correctly exits 0. The decision log accurately records the residual, but the workflow comment is a durable security-control explanation and would mislead readers about actual audit output. Update it to say no high/critical advisories remain and link or point to the recorded low residual, without changing the command, threshold, or policy; then review the changed CI-scope path at its required security tier. Do not characterize the current patch as showing zero advisories at every severity.

**Non-blocking:** None.

## Dependency and compatibility review

The graph delta is limited to the four already-present audited packages. `proxy-addr` changes 2.0.7→2.0.8; `source-map-js` 1.2.1→1.2.2; `prosemirror-view` 1.42.2→1.42.3; `@modelcontextprotocol/sdk` 1.30.0→1.31.0 in its two current direct consumers (`apps/api` and `packages/mcp`). The lockfile updates only these resolutions and their existing dependents; no package was added. Workspace overrides are exact patched versions, with no range widening to another major. Direct SDK peer requirements remain compatible with the existing Zod 4.4.3; its published engine floor is Node 18, below this project’s runtime. The ProseMirror upgrade is within the existing Tiptap range (`^1.41.9`). npm metadata reports the existing package licenses (MIT/BSD-3-Clause) and the versions exist.

The official advisories identify the chosen versions as the first patched releases: proxy-addr 2.0.8, source-map-js 1.2.2, prosemirror-view 1.42.3, and MCP SDK 1.31.0. The SDK advisory says stdio clients and SDK-built servers are not affected by the OAuth-client issue; this review treats its update as required graph/audit remediation and does not claim the TaskDesk MCP server had that vulnerable OAuth-client behavior. No test/assertion budget, CI threshold, scanner behavior, or policy was changed. The KaTeX low finding remains expressly documented as a residual below the existing high/critical CI failure threshold.

## Verdict

**CHANGES REQUIRED** at exact candidate `0e068f97f8716c6cc2d2f599fd533d7b623d08fd` until the stale workflow assurance is corrected. Dependency patch selection and the audit result otherwise match the cited sources and preserve the existing gates.

---

# Independent ordinary review A — audit-description correction

- **Exact candidate:** `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a`
- **Delta base:** `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`
- **Dependency-source base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Independence/model:** Fresh independent GPT-6 Luna ordinary-review context for the bounded patch; did not author, direct, or remediate it. The previous full dependency review remains applicable to the unchanged graph and package pins.
- **Files reviewed in this delta:** `.github/workflows/ci-fast.yml`, `scripts/ci/test-all.mjs`, `docs/07-planning/decision-log.md`.
- **Checks actually run:** Read the complete delta and searched the affected CI/manifest/docs surfaces for remaining absolute “zero at every severity” audit claims. `git diff --check` passed. No tests/CI were run for this comment/manifest-description-only delta; the exact prior source audit result remains applicable because package manifests, lockfile and override resolutions are unchanged.

## Findings

**Blocking:** None.

**Non-blocking:** None.

The prior blocker is resolved. Both the workflow and `test-all` manifest note now accurately state that `--audit-level=high` fails high and critical findings, while lower findings remain visible and do not fail that gate; neither claims the graph has zero vulnerabilities at all severities. The decision-log entry distinguishes this description correction and accurately records that the audit command, threshold, and behavior remain unchanged. In the workflow, only comments changed around the existing command. In the `test-all` manifest, only the informational `note` string changed; gate name, stage, command, and execution logic remain identical. The focused dependency repair still adds no package, changes no scanner threshold, and retains the known low KaTeX residual in the decision record.

## Verdict

**CLEAR** at exact candidate `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a` for ordinary review of this delta, retaining the prior full dependency-source review against base `3096cb044bdf6ae98488bfc385f532fa6386343a`. A fresh Sol review is still required for the security-scope workflow change before merge.

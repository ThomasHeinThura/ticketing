# Independent GPT-6 Sol security review — dependency audit prerequisite

**Reviewed head:** `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a`

- **Comparison base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Reviewer:** Fresh GPT-6 Sol security-review context. I did not author, direct, or remediate this candidate; this review is independent of the author and the two ordinary GPT-6 Luna reviews. I made no source edits.
- **Scope:** All seven changed files, including the complete lockfile diff, canonical override source, the two SDK consumer manifests, audit workflow/manifest descriptions, and the decision record. I checked the security-scope CI rule, actual SDK imports, advisory ranges and patch conditions, and package metadata. This is issue #613's existing-dependency prerequisite, not acceptance of control-plane PR #612 or a new feature.

## Verdict

**CLEAR for the required security review at this exact head.** No blocking or non-blocking security finding was found in this candidate. The patch changes only four already-present package versions and their resolutions. It does not add a package, change route authority, disable a gate, narrow audit scope, change `--audit-level=high`, or add an advisory suppression. The corrected CI descriptions accurately say that high/critical findings fail while lower findings remain visible.

This clearance is source review only. The required hosted CI checks must pass on the exact PR head, and the orchestrator must verify all other merge gates. It does not claim SIT acceptance or authorize merge by itself.

## Security assessment

- The lockfile resolves `proxy-addr` 2.0.8, `source-map-js` 1.2.2, `prosemirror-view` 1.42.3, and `@modelcontextprotocol/sdk` 1.31.0. Their previous vulnerable versions are removed from the lockfile; the other dependency families remain resolved as before. Both direct SDK consumers use the same exact 1.31.0 version.
- Primary advisories identify those releases as the patched minimum for [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [prosemirror-view](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w), and the [MCP TypeScript SDK](https://github.com/advisories/GHSA-6qxp-vccf-f47h). The ProseMirror fix addresses paste XSS. The proxy-addr fix addresses trusted-proxy IP spoofing. The source-map-js fix addresses blocking on malicious indexed source-map offsets.
- The MCP advisory warns that upgrading alone is insufficient for applications with persisted OAuth client credentials or certain OAuth providers. A targeted search of `apps/api` and `packages/mcp` found SDK imports only for `McpServer`, `StdioServerTransport`, and types; it found no OAuth client/provider/token-storage path in those two consumers. The advisory explicitly excludes SDK-built servers and stdio clients. This is a scope finding, not a claim about all possible future consumers.
- npm registry metadata confirms the SDK 1.30.0 and 1.31.0 dependency sets, peer dependencies, Node engine range, and MIT license match. `prosemirror-view` 1.42.3 requires `prosemirror-model ^1.25.8`, satisfied by the retained 1.25.11 resolution. The other patched packages retain their existing dependency families and licenses.
- The remaining [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7) affects the retained 0.16.47 version and is rated **low**. The decision log names it; the unchanged repository gate is high/critical. This residual is neither hidden nor waived.
- The later `8d5f5c1` commit changes only audit comments, an informational `test-all` note, and the decision record. The workflow command and the manifest's executable `run` array remain `pnpm audit --audit-level=high`; no status-check or budget logic changed. Image/runtime evidence from `0e068f97f8716c6cc2d2f599fd533d7b623d08fd` therefore applies to unchanged shipping inputs, with its source attribution retained.

## Checks actually performed

- Confirmed checkout HEAD and compared the full exact-head diff with the stated base; `git diff --check` passed and the worktree was clean.
- Ran `pnpm audit --audit-level=high`: exit 0, `1 vulnerabilities found / Severity: 1 low`.
- Ran `pnpm check:overrides`: passed, 39 overrides in `pnpm-workspace.yaml`, no competing source.
- Queried npm registry metadata for SDK 1.30.0/1.31.0 and the three patched transitive releases; read the five linked primary GitHub advisories.
- Read the independent ordinary reviews and the author report. I did **not** rerun their MCP/editor tests, builds, Docker build, container boot, or browser checks. The root runtime receipt separately records image `sha256:caab9bb9130f64f4617f8ce3714498a8ddc5103921d5582e287e304a5b75568f` from source `0e068f97f8716c6cc2d2f599fd533d7b623d08fd`, UID 10001, zero pending migrations, live/ready HTTP 200, no owner credential in the web output, and cleanup supplement with no remaining owned resources. I did not independently reproduce that runtime.

## Residuals

The low KaTeX advisory remains until a separately scoped fix. Hosted CI, PR review-note recording, and all PR #612/SIT gates remain the orchestrator's work; this review supplies only the independent security verdict on #613's exact candidate.

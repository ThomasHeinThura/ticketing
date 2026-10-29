# Repository audit — 29 October 2026

**Baseline:** main d968f7f4, performance candidate 925587dc6, and the existing per-ID evidence in [PR #918](https://github.com/ThomasHeinThura/ticketing/pull/918). Three high-tier source audits plus the coordinating audit inventoried 6,394 tracked files, read all 45 tracked Markdown files, and individually assessed every one of the 113 originally open issues. Four newly tracked gaps/work items bring the open inventory to 117. See the [complete issue/source/check ledger](report/audit/whole-product-20261029.json).

This is a repository-wide source, documentation, test and status audit. It is not exhaustive line-by-line semantic certification or whole-product browser acceptance. Archive content is historical and read-only. Source presence, current tests, browser evidence and Thomas's historical P0–P6 acceptance remain distinct.

## Findings that determine the plan

| Priority | Verified finding | Next action |
| --- | --- | --- |
| Urgent decision | Isolated persisted probes exposed a legacy time-entry ownership/feature-gate mismatch. A 23 October decision preserves that legacy surface unchanged. Customer records were not used. | [#927](https://github.com/ThomasHeinThura/ticketing/issues/927): Thomas resolves the retained-contract conflict before any behavior change; then a coherent authorization fix, negative tests and independent high-tier review. Detailed reproduction stays private pending remediation. |
| Release gate | Latest hosted [PR #919](https://github.com/ThomasHeinThura/ticketing/pull/919) has 25 other checks passing, but G11 LCP 2640.2 ms against 2500 and assignment 228 ms against 200. Zero qualifying headroom runs of three. | L-05 application diagnosis/fix; preserve all budgets/calibration. Three valid runs need at least 15% headroom across the required metrics. |
| Reliability | Fresh root unit run failed: API 2,383 passed/3 failed, and five web failures were observed before abort. Focused 18 API and 12 web tests pass. | L-02: diagnose full-path load/synchronization; focused passes do not clear the full failure. No timeout or assertion weakening. |
| Runtime | Both local HTTPS hosts return 502; the existing app container is stopped, supporting services are up. | Recover existing Compose SIT with preserved data before fresh product browser acceptance. No account seeder or protected database fixtures. |
| Evidence integrity | [build-data.mjs](../scripts/report/build-data.mjs) hard-codes P0–P5 and can discard P6 and richer report metadata. | [#928](https://github.com/ThomasHeinThura/ticketing/issues/928). Preserve the existing per-ID work; use only the renderer for this update. |
| Confirmed residual features | Shared Pages/KB editor features and autosave, scoped settings entry points, export buffering, import retry/loss accounting, notification preferences, configuration audit events and the persisted MCP injection journey need further work. | Retain separate coherent slices in the [roadmap](roadmap.md), with complete API/UI/persistence/permission/i18n/test acceptance. |
| Stale issue claims | Hierarchy, pending actions, portal attachments, approvals pages, WebSocket origin/session checks, attachment GC and the installer have substantial implementation despite older issue wording. | Verify residual criteria and close only with an issue-specific evidence packet. Do not rebuild those features from an old title. |
| Documentation | 26 local Markdown link targets are broken; three site-content guides still call shipped UI unavailable. | L-10 documentation correction against actual shipped behavior; no claim that these source guides are currently published. |

## Executed checks and limits

- Fresh forced typecheck: 9/9 tasks, zero cached; clean tracked-source lint: 4,831 files pass. Dirty-tree lint still fails on 10 ignored backup manifests; those files were preserved.
- Thirteen gates pass, including 118 permission tests, the separate route-policy invocation, contract drift, UI raw-element, policy, inventory, env/events/dependency/i18n/override/Dockerfile checks. CI-script suite: 1,374 passed, 20 skipped, zero failed; the skipped count is retained.
- Fresh full integration on owned disposable PostgreSQL: **478 files / 5,789 tests passed** (26m35s Vitest; owned container stopped and removed by exact ID). Focused audit probes intentionally fail the expected legacy boundary assertions; they are diagnostic evidence, not shipped passing regression tests.
- Fresh dependency audit: zero high/moderate, one existing deepmerge low ([#909](https://github.com/ThomasHeinThura/ticketing/issues/909)); the configured high-severity gate passes. Full-history Gitleaks: 22 raw detections, classified as digests, public identifiers, isolated fixtures, historical prose and an invalid example; zero confirmed credential exposures among those hits. No suppression/allowlist changed.
- Trivy on the **older local** 01c47cb65 image reports 42 HIGH, 57 MEDIUM and 60 LOW; none of the HIGH findings has a fixed version in that scan. This is not a fresh scan/signature verification of the latest signed release.
- Main Fast CI, CodeQL and Release passed; merged PR #925 still had G11 red, and no main Full CI run was found for that SHA. Release success does not establish all-required-green.
- The standalone audit report was checked in Chromium at 1440/375 px in both themes: four cases pass, all four captures visually inspected, dated historical receipts visible, no page errors or horizontal overflow. Long evidence URLs now wrap in the existing renderer; stale phase-review wording was corrected. [Desktop capture](report/screens/whole-product-20261029-report-1440-light.png) and [mobile capture](report/screens/whole-product-20261029-report-375-dark.png). This is report validation, not product browser acceptance.
- New G8/G4, full-product role/browser, load, restore, large-export and real-Entra acceptance were not run by this audit. Prior [gate evidence](report/audit/l01-gates.json), [route-case manifest](report/audit/l01-sit-matrix.json) and later scoped performance/browser evidence retain their original revision/fixture limits.

## Requirements, issues and deadline

PR #918 already classifies all 673 clauses: **19 tested, 630 source-only, 15 partial, 6 external-blocked and 3 unverified**. All 73 indexed source contracts remain unverified in that index. This update preserves those counts; broad test/crawl results do not promote whole-clause acceptance.

Every original open issue has a source assessment, remaining acceptance and a backlog row in the ledger. No original issue has a complete current closure packet in this audit; none is bulk-closed from phase acceptance. The four added issues are #927 legacy contract, #928 report rebuild, #929 release regression and #930 settings split.

Thomas's target is tomorrow night. The [delivery goals and checkpoints](roadmap.md#delivery-goals--30-october) use **30 October 2026, 22:00 Yangon** as a working checkpoint. The audit does not support promising all issues, substantial new screens and external acceptance by then. The immediate path is accurate evidence, working SIT, the urgent contract decision and performance/reliability gates, then the retained backlog. No merge, workflow change, retained-contract change or public deployment is authorized by a calendar target.

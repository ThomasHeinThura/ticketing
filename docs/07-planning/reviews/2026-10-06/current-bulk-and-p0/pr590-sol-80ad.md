# Independent GPT-6 Sol security review — PR #590

**Exact head:** `80ad3ba85530190c18bca94ad7aa249971899c11`  
**Prior ordinary-review head:** `32ed86f472645a2c69ea7200c1955e4787bbb1ad`  
**Reviewer:** independent GPT-6 Sol context; I did not author, direct, or remediate this candidate and made no source edits.  
**Source verdict:** **CLEAR at this exact head for the security-scope review.** This does not clear the red hosted G11 or E2E checks, grant product acceptance, or make the PR mergeable.

## Scope and risk classification

I read the repository workflow and authoritative security-path list, the original two independent Luna reviews that blocked the pending-shell Escape lifecycle at `32ed86f`, and the independent Luna delta review at `80ad3b`. I inspected the complete seven-file `75d2c97b..80ad3b` PR delta and the five-file `32ed86f..80ad3b` correction. The security-path trigger is `apps/web/e2e/**`; the production route TSX and UI trigger do not alter API policy, permissions, authentication, tenancy, persistence, or a required gate's pass/fail semantics. The E2E fixture Origin reflection is a mock-only Playwright page-route response, not a production CORS configuration or security assertion. This is a bounded UI loading and test-fixture change, so a focused Sol security confirmation is proportionate.

## Source findings

No blocking security or authority finding was established. The route still renders its permission-gated `WorkItemCreateTrigger`; the extracted shell uses the shared `@taskdesk/ui` dialog and passes the same project/workspace IDs into the existing create form. The route preloads the list panel independently and loads the create shell only on intent. The pending-state `keydown` listener exists only while open, not ready, and not in error; Escape closes the pending intent and refocuses the trigger. A late import sets readiness but cannot render the shell while `isCreateOpen` is false. The regression holds the wrapper request, presses Escape before release, verifies pending UI and dialog are gone with focus restored, releases the request, verifies it stays closed, then reopens. The loaded dialog retains its own Escape/close handling. Error recovery remains the documented reload action. Sort/layout URL state and route registration are unchanged.

The regenerated contrast manifest has the same **434 pair definitions** and identical pair semantics; its source occurrence count changes from **2,852 to 2,860** for extracted shell caller contexts. No contrast threshold, theme, or primitive authority changed. The G11 helper now echoes the browser request Origin in credentialed mock responses and preflight; it is scoped to the performance/E2E fixture and does not test or modify real API CORS enforcement. I found no route-permission bypass or test skip in the diff.

## Checks actually performed

- Confirmed clean worktree and `HEAD` exactly `80ad3ba85530190c18bca94ad7aa249971899c11`.
- Focused route preload Vitest: **1 file, 1 test passed**.
- `pnpm --filter @taskdesk/web typecheck`: passed for app and node TypeScript configurations.
- `git diff --check 32ed86f472645a2c69ea7200c1955e4787bbb1ad..HEAD`: passed.
- Parsed old/current contrast JSON to confirm 434 unchanged pair semantics and occurrence counts 2,852→2,860.

I did not run browser/E2E, hosted G11/performance, SQL, Docker, image boot, or external credentials. The ordinary reviewer reports browser/evidence and author checks separately; I do not transfer those as my own results.

## Residual gates

At handoff, hosted G11 remains **red, 19/22**, with the create journey failing; E2E remains **23/24**. The private G11 observer README says its prior capture was cache-warmed and unsuitable for timing acceptance; its revised harness is source-only preparation, not a passing budget measurement. I did not rerun or diagnose those hosted failures here. Their exact current check status, any other required CI, branch protection, independent ordinary review, and runtime/product acceptance remain separate requirements. This source verdict must not be presented as a waiver or merge approval.

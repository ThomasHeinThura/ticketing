# PR #782 — documentary prerequisite review records

**Reviewed head:** `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`

The original component, accepted-main composition and bounded wording correction are retained. Two independent ordinary reviewer contexts clear the current source; fresh independent Sol clears this documentation contract. Earlier adverse reports and superseded clearances remain authentic and source-bound. These are five report versions from three independent reviewer contexts, not five approvals.

This note does not accept webhook/API-key implementation, runtime behavior, P4, #718 as a whole, or the carrier. Exact-head CI and normal protected merge remain separate gates. The Sol non-blocking self-read caveat remains: the documented target read-capability subset is not proof that accepted-main self policies enforce it.

The conductor explicitly selected GPT-6 Luna/Sol for the new contexts; reports retain their actual runtime-attestation limitations. Original authoring remains attributed to Claude. Raw reports below are reproduced byte-for-byte, including intentional Markdown whitespace.

## Authentic report: 782-prerequisite-ordinary-a-luna.md

# PR #782 ordinary review A — webhooks spec sections, register disposition, self-row rule

**Reviewed head:** `5a82e30c7c3207b454545144bd3658a0ad5827df`
**PR / branch:** #782, `codex/webhooks-review-disposition-718`
**Comparison base:** `9297362b5f2dd1f17da935c8051c1562b473638a` (merge base; exact base stated by live PR was `9297362b5f2dd1f17da935c8051c1562b473638a`)
**Reviewer / context:** GPT-6 Luna, fresh independent ordinary-review context; did not author, direct, or remediate this change or the prior #777/#718 dispositions.
**Risk classification:** FULL ordinary-review depth as directed: the spec and governance register import API-key ownership/authority, route-policy, SSRF, notification, and customer-boundary contracts. Runtime effect is none; the review still checks that documentation does not imply an unaccepted feature or authority decision.

## Scope and method

Reviewed the exact PR head, live PR body, both changed documents and their complete diff. Independently checked the original 12-row section 7 in `features-governance-design.md`, the new disposition row by row, the prior authentic reviewer D report (`777-review-d-sonnet.md`) and #718 disposition report in restricted takeover evidence, `schema.ts`/`auth-schema.ts`, `data-model.md`, route-policy/RBAC docs, event and notification catalogues, feature and API specs, screen inventory, configuration reference, CI scripts, and direct owner comments on #724 and #718. Checked actual #783/#784 PR state and exact source. Ran `pnpm check:reviews` (passes: all named specs have empty review sections) and `git diff --check` (clean). Verified the candidate’s runtime paths: `git diff --quiet <base> <head> -- apps packages tests` exits 0. The PR diff is two original documentation files, +142 lines, no deletions; candidate parent is `4adc2d18d3902fdd8ee475773270748113ff9f15` and merge base is the stated base.

The authentic #777 reviewer D report at `777-review-d-sonnet.md` was not treated as a substitute for current verification. Its material correction (the notification sender has an inherited SSRF guard/test) is present in the current spec and register. Its earlier #724 “pending” wording was fixed in the candidate; the remaining false implementation status below is independently confirmed against live PRs.

## Findings

### Blocking

1. **The Open questions paragraph implies the owner-approved API-key ceiling is already implemented.** It says the 2026-10-15 owner decision “is implemented by PR #784.” Thomas did decide the ceiling on #724; however, live #783 and #784 are both still OPEN and neither is merged. #784’s current head is `8b424730db935240046df903b0d20d7a0fbd3f61`. This is a documentation-only PR against a data model that explicitly says the `api_key` extension is not present on main. The present-tense wording can be read as accepted runtime implementation, contradicting the spec’s own distinction between designed columns and deployed schema and the register’s “design closure only” boundary. Reword to say that implementation is *tracked/proposed* in the open PR(s), and retain the direct owner decision as settled. Do not imply #724's runtime behavior is accepted until #784 (and its dependency #783) lands and is verified.

### Non-blocking

- **Owner direction and scope:** #718’s direct owner comment says item 1 is not deferred and requires independent mapping/disposition before the self-row paragraph merges. The two new sections and paragraph meet that documentary scope; no finding is falsely marked as a passed test.
- **Register history:** the original 12 rows and historical “ready-with-fixes” text are preserved. The dated disposition explicitly says design findings only and that tables, routes, delivery, tests, and stage acceptance are not implemented. Rows 9 and 12 now have three sections and specific planned test names plus assertions; the files are candidly marked absent and assigned to #47. Reviewer D’s earlier correction about the inherited notification SSRF sender is present. `pnpm check:reviews` confirms the structural check only; it does not validate the accuracy of every disposition.
- **Schema and column inventory:** `schema.ts` has `outboxTable`, better-auth `apikeyTable`, and inherited notification preference columns `webhook_enabled`, `webhook_url`, `webhook_secret`; it has no feature `webhook`/`webhook_delivery` tables or TaskDesk `api_key` extension. `data-model.md` documents the planned extension’s `workspace_id`/`person_id` exactly-one check, capabilities, IP allowlist, rate limit, expiry, last-used fields, prefix, `is_mcp`, and disable fields. The spec keeps the inherited `apikey` table distinct from the proposed extension and does not invent a service-key exception to the owner ceiling.
- **Routes/RBAC and key-owner/customer ceiling:** the self-row paragraph says a self policy does not grant key mutation authority; it limits the affected resources to the caller’s notification, preference, workspace-rule, and avatar writes, and preserves read-only self access under stored read capabilities. The distinct route-policy forms and `self` policy reference are consistent with the cited registry/RBAC contract. The #724 gap is separated from current implementation in the Data section. No IdP data, customer membership, `instance:admin`, or `sees_all` grant is added.
- **Test names and feature boundary:** named webhook SSRF/signature/key-clamping files are not presented as existing or passing; no feature-specific tests are present in the tree. The inherited notification sender’s test is accurately distinguished. No code, dependency, gate semantics, new model policy, or waiver is added.
- The spec contains a pre-existing reference to `check:route-policy-syntax`; current scripts expose `check:route-policy`. The PR notes it as pre-existing/not changed. This is not introduced by the diff and is not a blocker for this candidate.

## Verdict

**REQUEST CHANGES — BLOCKED.** Correct the unmerged-implementation wording and review the changed delta at its new exact head. This is an ordinary documentation finding, not a claim that the documented authority rule itself is undecided. No security-scope code, policy registry, or gate implementation is changed; this review does not replace the required security review for the separate API-key implementation PRs.

## Limits

No webhook/key implementation, API route, RBAC behavior, database migration, browser flow, or deployment was run or changed. `check:reviews` passing establishes only the structural register result. The review does not accept #47, #783, #784, any webhook SSRF/signature behavior, API-key runtime behavior, or a phase/stage.


## Authentic report: 782-prerequisite-ordinary-b-luna.md

# PR #782 prerequisite ordinary review — independent B

**Reviewer:** GPT-6 Luna (independent fresh context; no authoring, directing, or remediation)
**Reviewed head:** `1437a4eb243d9b881dec84a5e005eb26dc85ed18`
**Comparison base:** accepted `main` `d93c0967ecc7b1a1d721ff25202737cd72430a0d`
**PR:** https://github.com/ThomasHeinThura/ticketing/pull/782
**Scope:** current-main composition; 96 lines in `webhooks-and-api-keys.md` and 46 lines in the owning governance-review register.

## Verdict: CLEAR

The changes are bounded to a prerequisite spec update and a finding disposition. The self-row paragraph is directly supported by the accepted decision-log entry “Keep self-only personal writes session-only until explicit API-key scopes exist” (2026-10-06): mutations remain session-only until registered key capability/scope exists, while existing read-only self routes remain unchanged. It does not convert self ownership into API-key write authority or bless arbitrary stored permissions. The route policy continues to decide the row scope. This is consistent with the security model's separation between authenticated identity and authority, and the documented rule that IdP/SCIM data cannot grant `instance:admin` or `sees_all`.

The Data table correctly distinguishes designed schema from current implementation: `outboxTable` and better-auth `apikeyTable` are present in `schema.ts`; there is no feature `webhook`/`webhook_delivery` table or `api_key` extension there. It explicitly distinguishes inherited notification preference webhook columns from the outbound-webhook feature. The named webhook SSRF/signature and owner-clamp test files are described as future implementation-lane tests, and the text explicitly says they do not exist and must not be claimed as passing. The Out of scope and Open questions sections point to existing decisions/issues; the #724 authority note accurately reflects Thomas's live decision. No customer key behavior or identity-provider-derived authority is invented.

I checked the owning §7 review section against its twelve original findings and their proposed fixes. The twelve disposition rows map each original concern to a specific authoritative spec, architecture, data-model, inventory, configuration, or route-policy location. In particular, findings 9 and 12 distinguish design closure from runtime/test implementation; the explanatory row-12 rationale is consistent with the original request for named tests and the feature's P4/#47 implementation owner. The disposition keeps the original historical finding text and clearly labels the new tally as design findings only; it does not claim webhook code, tests, delivery, or stage acceptance. I also checked the source-bound #777 review reference and correction described in the author handoff as historical context only; that component review is not treated here as current approval.

The current-main composition is structurally sound: the retained PR head `5a82e30c7c3207b454545144bd3658a0ad5827df` and accepted main are ancestors of the prepared head. The unique diff against accepted main consists only of the two named documentation files. `git diff --check` passed. `pnpm check:reviews` passed on this exact prepared head and reported `webhooks-and-api-keys.md` as the named spec with an empty review section. No product tests were run because there is no product/runtime source change.

## Risk and limits

Classify this as **full substantive review**, not policy-only: it updates a security-relevant feature contract and the finding disposition, though the candidate is documentation-only. The changed paths are outside the current security-review path list in `ci-cd.md`; no route-policy, auth, CI gate, or runtime authority semantics changed. This ordinary review does not claim to satisfy the required review count for a full substantive candidate, any separately applicable Sol review, current-head CI, or protected merge gates. No blocking finding remains in the reviewed documentation prerequisite. It does not accept implementation issue #47, API #784, the carrier, webhook delivery, or runtime/security behavior.


## Authentic report: 782-prerequisite-ordinary-a-current-luna.md

# PR #782 ordinary A follow-up — prepared current head

**Reviewed head:** `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`
**Prepared parent:** `1437a4eb243d9b881dec84a5e005eb26dc85ed18`
**Original component source retained:** `5a82e30c7c3207b454545144bd3658a0ad5827df`
**Accepted-main parent conserved:** `d93c0967ecc7b1a1d721ff25202737cd72430a0d`
**Worktree:** `/Users/heinthura/.codex/worktrees/pr782-current-prep/Ticketing.v2`
**Reviewer selection:** GPT-6 Luna, fresh independent ordinary-A context, selected by the orchestrator for this follow-up. Runtime/tool metadata does not expose a separately verifiable model/provider identity, so this report records the requested selection without claiming independent platform attestation.
**Risk classification:** FULL ordinary-review depth as directed. The spec and historical review register document API-key authority, tenant reach, route-policy and SSRF boundaries; no runtime authority or gate implementation is changed.

## Scope and conservation checks

Read the remediation handoff and preserved initial A report (SHA-256 `0abc351dd06114b8e73a6f11c20cef95932e493f5ba40f899d09a2e7292326da`). The preserved report's bytes still match that hash. Read the exact prepared head directly from Git and verified its parent. Original source `5a82e30c…` and accepted main `d93c0967…` are both ancestors. The `1437a4eb…` to `d930cfc2…` delta is confined to `docs/03-features/webhooks-and-api-keys.md` (+5/-4). Relative to accepted main, the candidate changes only the two original documentation paths (`webhooks-and-api-keys.md` and `features-governance-design.md`); all `apps`, `packages`, and `tests` paths are byte-identical to accepted main. The worktree is clean.

Reviewed the changed paragraph at this exact head and rechecked the related spec/register claims against the original A review, authentic #777 reviewer-D report, `schema.ts`/`auth-schema.ts`, `data-model.md`, `rbac.md`, route-policy documentation, and the direct owner comment on #724. Queried the current state of #783/#784: both are OPEN and unmerged; #784 head is `8b424730db935240046df903b0d20d7a0fbd3f61`.

## Delta finding

The prior blocker is resolved. The text now says the Thomas #724 project-role clamp decision is settled, identifies implementation as proposed in open #784, states that #784 pairs #783 capability propagation with the owner-role clamp, and explicitly says #783 is not separately accepted and runtime implementation/acceptance remain pending. This accurately distinguishes an owner decision from unmerged implementation and does not imply service-key semantics were changed. The former “implemented by PR #784” claim is gone.

The rest of the spec/register review remains as in the initial A review: the data table names the designed `api_key` columns and accurately marks the extension and feature webhook tables absent from main; inherited better-auth `apikey` and notification preference webhook columns remain distinct; the owner ceiling is specific to the personal-key `AK-3` rule, with service-key `AK-7` documented separately; no customer identity or IdP data is made an authorization source; the route/RBAC and self-row restrictions do not create API-key write permission; planned webhook tests are explicitly absent/not passing; all twelve historical findings remain visible and are dispositioned as design findings only. The register’s historical and implementation-lane boundaries remain intact. No new scope, owner decision, runtime acceptance, gate waiver, or security-policy change appears in this delta.

## Checks and limits

At this exact head, `pnpm check:reviews` passes (the named spec has an empty review section); `pnpm check:vocabulary` passes (111 registered tables, with existing baseline notices); `pnpm check:events` passes (34 event keys registered); `git diff --check` is clean. These checks and the ancestry/source-conservation comparisons are read-only. No webhook or API-key implementation, route behavior, RBAC enforcement, database migration, browser flow, or image was run.

## Verdict

**CLEAR — ordinary A review of exact prepared head `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`.** The bounded correction resolves the prior blocker, preserves the original source and accepted main, and makes no false implementation claim. This is only ordinary reviewer A clearance; it does not satisfy the remaining independent ordinary review or any security review required for separate API-key runtime changes, and it is not runtime or stage acceptance.


## Authentic report: 782-prerequisite-ordinary-b-current-luna.md

# PR #782 exact-head ordinary delta review — independent B

**Model / dispatch:** GPT-6 Luna was requested for this ordinary-review task. This subagent runtime does not expose a separate model-version or dispatch token that can be independently recorded; no claim is made about an external model invocation.
**Reviewed head:** `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`
**Comparison base:** accepted `main` `d93c0967ecc7b1a1d721ff25202737cd72430a0d`
**PR:** #782, existing PR #782; review is bound to the prepared local exact head, not the remote PR's older head.
**Remediation parent:** `1437a4eb243d9b881dec84a5e005eb26dc85ed18`
**Independence:** fresh context, did not author, direct, or remediate the candidate.

## Verdict: CLEAR for this documentation prerequisite

The remediation fixes A's sole blocking concern. The feature spec now says Thomas's #724 owner decision is settled, but its implementation is only proposed in open PR #784, pairs #783 capability propagation with the project-role clamp, says #783 is not separately accepted, and leaves implementation and acceptance pending. This no longer implies accepted runtime behavior. Live GitHub confirms #783 remains OPEN at `e0d5e9c25a80ba65ed5392f5ce06e152347b5c7f`, and #784 remains OPEN at `8b424730db935240046df903b0d20d7a0fbd3f61`.

The original A report's other material concerns remain accurately bounded: the feature data section distinguishes the designed extension from current schema; the owner-authorized self-row paragraph does not grant API-key write authority; IdP/SCIM does not grant `instance:admin` or `sees_all`; and all twelve original section-7 findings have specific evidence and disposition, with the prose distinguishing design closure from absent implementation/tests. The correction to implementation status is consistent with those limitations and introduces no new authority or customer-specific rule.

I reconsidered the finding despite my prior ordinary-B CLEAR report at the parent head. A's finding was valid: I had not challenged the present-tense “implemented by PR #784” wording against the live state and data table. The prior B report is preserved byte-for-byte but is superseded as a verdict by this exact-head re-evaluation. A's original report remains historically valid for its reviewed source head.

## Exact-head checks and provenance

I verified `HEAD` is `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`; retained source head `5a82e30c7c3207b454545144bd3658a0ad5827df` and accepted main `d93c0967ecc7b1a1d721ff25202737cd72430a0d` are ancestors. The remediation delta from `1437a4eb243d9b881dec84a5e005eb26dc85ed18` changes only `docs/03-features/webhooks-and-api-keys.md`; the unique diff against accepted main remains the two original documentation paths. `git diff --check` passed. On this exact head, `pnpm check:reviews` passed (the named feature has an empty review section), `pnpm check:vocabulary` passed (111 registered tables, baseline notices only), and `pnpm check:events` passed (34 published keys registered). These are structural/docs checks; they do not validate runtime behavior.

## Risk and limits

This is **full substantive ordinary-review depth**, not policy-only: the spec and governance register document security-relevant API-key, route-policy, SSRF, notification and customer-boundary contracts. The changed paths are outside the current `ci-cd.md` security-review path list, and this candidate changes no route policy, auth implementation, CI gate or runtime authority semantics. This report does not establish whether any additional independent ordinary count or separate Sol review is required for the overall candidate, and does not satisfy current-head CI or protected-merge requirements. No product tests, build, database, browser, image or runtime acceptance were run; this subagent cannot claim them. It does not accept #47, #783/#784, webhook delivery, API-key runtime behavior, the carrier, or a stage.


## Authentic report: 782-prerequisite-security-current-sol.md

# PR #782 prerequisite security and contract review

**Reviewed head:** `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`  
**Comparison base:** accepted `main` `d93c0967ecc7b1a1d721ff25202737cd72430a0d`  
**Retained original component:** `5a82e30c7c3207b454545144bd3658a0ad5827df`  
**Role and provenance:** fresh independent security/contract reviewer context, assigned the Sol-tier role by the parent task. The task explicitly selected GPT-6 Sol. This runtime supplies no separately verifiable provider/model-version or spawn-argument attestation; “GPT-6 Sol” is the requested selector, not a claim of independent runtime identity proof. I did not author, direct, or remediate this candidate.

## Verdict

**CLEAR for this bounded documentation prerequisite at the reviewed local head.** No blocking security or contract finding. This verdict closes neither the P4 implementation nor its runtime/security acceptance. The remote PR #782 was still open at original head `5a82e30c7c3207b454545144bd3658a0ad5827df` when queried, so this report is not a review of a newly pushed remote exact head or of its status checks.

## Scope and evidence

The accepted-main-to-candidate diff adds 143 lines in exactly two paths: `docs/03-features/webhooks-and-api-keys.md` and `docs/07-planning/reviews/2026-09-05/features-governance-design.md`. Both original component and accepted main are ancestors of the reviewed head. `git diff --exit-code` confirmed `apps/`, `packages/`, `tests/`, `.github/`, and `scripts/ci/` match accepted main byte-for-byte; the worktree was clean. There is no product code, migration, route, table, CI gate, or runtime authority change. The spec and register are nevertheless security-relevant normative text, so I reviewed their authority claims and finding disposition at full contract depth rather than treating them as records only. The two changed paths are outside the current `ci-cd.md` mandatory security-review path list; this independent Sol pass was requested for the contract risk.

I read AGENTS, the active mission, workflow, provider adapter, the full candidate diff, the original twelve §7 findings, authoritative data-model/RBAC/events sections, and Thomas’s direct #718 and #724 comments. #718 explicitly requires mapping every open §7 finding before carrying the self-row paragraph. The register preserves the twelve original findings and gives each a numbered design disposition; rows 9 and 12 distinguish specified sections/test names from absent implementation. The design closure neither waives a gate nor grants runtime acceptance. The planned SSRF, signature, key-clamp, webhook-reach, and service-key tests are named and explicitly marked absent. `check:reviews` passed because the named feature’s active review section is empty.

The data table agrees with the current schema: `outboxTable` and inherited better-auth `apikeyTable` exist; the designed `webhook`, `webhook_delivery`, and `api_key` extension do not. The notification-preference webhook columns and sender guard/test are explicitly distinguished from the unbuilt P4 webhook feature. The extension columns and 30-day delivery retention are named in `data-model.md`. The changed text adds no customer-specific key, environment variable, IdP mapping authority, `instance:admin` grant, or `sees_all` grant. Existing authoritative RBAC confines IdP mappings and treats `self` as row ownership, not a capability grant.

The #724 paragraph follows Thomas’s direct decision: personal-key effective authority must include the owner’s current project role so it cannot exceed the owner’s session there. The candidate says the paired #783/#784 implementation is proposed and still pending; live GitHub showed both PRs open. This is consistent with personal-key `AK-3` and does not rewrite service-key `AK-7` into a current-owner clamp. The self-row paragraph follows the 2026-10-06 recorded decision: listed self-only writes require a session until a registered key capability and policy exist; mere ownership and arbitrary stored permission strings do not authorize the writes. It does not create a new API-key write capability.

## Non-blocking precision limit

The sentence “Read-only self routes remain available under the key’s stored read capability subset” describes the target key model. On accepted main, the extension’s stored capability column is absent and the existing `self` policy does not consult `keyCapabilities`; `resolve-identity.ts` explicitly calls out that distinction. The adjoining Data section says the extension is absent, and the 2026-10-06 decision says read-only self routes remain unchanged. Thus this sentence should not be cited as proof of present read-policy clamping. Any implementation or acceptance claim for those reads needs separate route-level verification. This is a documentation precision caveat, not a new grant or a blocker for the narrow prerequisite.

## Commands and limits

`git rev-parse HEAD`, ancestry checks, `git diff`/file conservation checks, `git diff --check`, `rg`/source reads, `gh issue view 718/724`, `gh pr view 782/783/784`, and `pnpm check:reviews` ran successfully. The remote PR check rollup contained cancellations at its older head; it cannot establish current-head CI readiness. I ran no database, Docker, browser, product integration, webhook delivery, or API-key runtime test. No source, PR, or review note was mutated by this reviewer.

**Blocking findings:** none.  
**Non-blocking findings:** the read-only self-route precision limit above.  
**Residual:** implementation and tests for P4/#47 and the #724 paired change remain open; exact-head GitHub checks/review publication and protected merge belong to the conductor.




## Accepted-main composition confirmation — 2026-10-16

**Reviewed head:** `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`

This clean normal merge includes accepted main09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6 after protected PR802. All12 imported paths are blob-identical to accepted main; the three PR-specific files remain byte-identical to prior reviewed publication8ea03bf9. Original normative d930 retains two ordinary and full Sol clearance. One new independent ordinary context and one new lightweight independent Sol context confirm this mechanical import changes no candidate-specific authority or gate semantics. Both original and current reports remain authentic; seven report versions are not seven approvals. Fresh contexts were explicitly selected as gpt-6-luna/gpt-6-sol with fork_turns=none; runtime version introspection remains unavailable and is not invented. Root composed/published and is not a reviewer.

The self-row read-only subset remains a target contract, not runtime proof. Twelve design findings are dispositioned without accepting implementation, planned tests, issue718/777/47, standalone783, provider activation or H1–H6. Preserved raw Markdown whitespace is not rewritten or claimed clean. Required exact-publication hosted CI remains pending; the accepted main image proof does not transfer a product-implementation result to this documentation change.

### Record 1

# PR #782 accepted-main import — ordinary confirmation

**Reviewed head:** `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`
**Comparison base:** previously reviewed publication `8ea03bf9f2d67c420aa2ecfc73e33a9e0d48567e`; accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`
**Role:** fresh independent ordinary confirmation of accepted-main composition; did not author, direct, or remediate this candidate. The assigned model selector was GPT-6 Luna. Runtime metadata does not independently attest model/provider identity, so this report records the selector without claiming external identity verification.
**Scope:** exact-head parent/tree/blob conservation, preservation and coverage of the original #782 review record, and whether this candidate changes authority or gate semantics beyond the already accepted main import.

## Checks and evidence

- `HEAD` is exactly `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`, a normal two-parent merge of `8ea03bf9f2d67c420aa2ecfc73e33a9e0d48567e` and `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`. Both expected parents are ancestors.
- The accepted-main-to-candidate tree delta is exactly three PR-specific paths: `docs/03-features/webhooks-and-api-keys.md`, `docs/07-planning/reviews/2026-09-05/features-governance-design.md`, and `docs/07-planning/security-reviews/782-webhooks-review-disposition.md`. All three compare byte-for-byte equal to the previous publication. The 12 imported paths and blob IDs in `782-accepted-image-main-conservation.json` match accepted main exactly. The `apps/`, `packages/`, and `tests/` trees also match accepted main. Worktree status was clean.
- Read the repository authority/workflow guidance and the complete preserved #782 disposition note. Its five authentic report versions remain source-bound: the original ordinary-A blocker; original ordinary-B report and explicit superseding re-evaluation; current-head ordinary-A and ordinary-B clears; and the current-source Sol contract review. The previous independent reports cover the underlying normative source `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`, with the original twelve governance findings retained and each dispositioned as design closure only. The Sol report's caveat remains explicit: the self-row stored read-capability subset is target contract, not proof of runtime enforcement. Planned webhook/API-key tests remain identified as absent; no feature, #47, #783, #784, runtime, or stage acceptance is claimed.
- Re-read the three PR-specific files and relevant accepted-main CI workflow/helper sections. The spec still says the #724 implementation is proposed in paired open #784/#783 work, #783 is not separately accepted, and runtime acceptance is pending. It does not imply a standalone #783 acceptance. The accepted import adds no additional change on top of accepted main: the shipping-image workflow invocation and helper, their tests, and accompanying CI/decision/status records are byte-identical to accepted main. Thus this candidate introduces no new authority or pass/fail semantics beyond the already accepted #802/main change.
- `git diff --quiet` checks passed for all 12 imported paths, the three PR-specific paths against old publication, and `apps/ packages/ tests` against accepted main. `git diff --check 09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6 HEAD` reports trailing whitespace and a final blank line in the preserved raw Sol report inside the PR's review note. Inspection confirms those bytes are unchanged from the previous publication and intentionally preserved with the authentic source-bound report; this is not introduced by this merge/import.

No suites, Docker, PostgreSQL, browser, or runtime behavior were run; this task only needed composition and scope confirmation. The accepted-main import itself has its separate recorded PR #802 checks and hosted image evidence; those are not recast here as checks run by this reviewer.

## Verdict

**CLEAR — ordinary confirmation of accepted-main composition at exact head `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`.** Parentage, imported path/blob identity, PR-specific source conservation, and the original review coverage are intact. No blocking finding. The whitespace finding is inherited, intentional preservation in the unchanged authentic report text. This report does not replace the required lightweight independent Sol confirmation for this current import confirmation, current-head GitHub checks, or protected merge gates.


### Record 2

# PR #782 accepted-main import — lightweight security confirmation

**Reviewed head:** `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`  
**Comparison:** old reviewed publication `8ea03bf9f2d67c420aa2ecfc73e33a9e0d48567e`; accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`  
**Role and independence:** fresh independent security reviewer context. I did not author, direct, or remediate this candidate. The parent dispatched this context with `model=gpt-6-sol` and `fork_turns=none` for the Sol-tier review. This records the explicit selector and fresh-context provenance; the runtime exposes no separate serving-model/version attestation.  
**Depth:** lightweight confirmation of a mechanical accepted-main import. The underlying security-relevant PR #782 documentation contract already received two independent ordinary clears and a full independent Sol clearance on normative source `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777`; this pass does not replace or re-label those reviews.

## Checks and result

- `git rev-list --parents -n 1 HEAD` confirms an ordinary two-parent merge: the reviewed publication and accepted main are its exact parents. The normative source `d930cfc2d9d9db6d660820bc7fb3a5a18ed90777` is an ancestor. The worktree is clean.
- Independently recalculated the conservation ledger from Git objects: all **12** imported paths have the ledger's blob ID and the same blob at accepted main; the **three** PR-specific paths have the same blobs as the old reviewed publication; the `apps/`, `packages/`, and `tests/` trees equal accepted main. The accepted-main-to-candidate diff is only `webhooks-and-api-keys.md`, `features-governance-design.md`, and the PR's own review-disposition note. `git diff --quiet` for those three paths against the old publication exited 0.
- Read the preserved PR #782 note and its five authentic report versions, including the original A blocker, B re-evaluation, two current-source ordinary clears and full Sol contract review. The original twelve governance findings remain dispositioned as **design** findings; the note retains the Sol caveat that a target read-capability subset for self rows is not evidence of current runtime clamping. No new API-key write grant or identity-provider authority is introduced by this merge.
- Checked the feature spec's relevant current contract. It identifies #783/#784 as a proposed paired implementation, says #783 was not separately accepted, and leaves runtime implementation and acceptance pending. Live GitHub still lists #783 and #784 as open. Named webhook/API-key tests for P4/#47 remain planned; no feature, runtime, issue, or stage closure follows from this document import.
- The security-scope import (`.github/workflows/ci-full.yml`, `scripts/ci/**`, `docs/04-engineering/ci-cd.md`, and related records) is blob-identical to accepted main. It adds **zero** candidate-specific authority or CI pass/fail behavior beyond accepted main. The separate #802 accepted-main conservation receipt reports its merge tree equals reviewed candidate `da6fdb1a86f5415cd14601fbd0e40ec070718dea`; I also verified that tree ID equality locally. #802's ordinary/full-Sol clearance and hosted image proof remain source-bound evidence, not tests performed in this review.
- `git diff --check` against accepted main exits 2 on five trailing-space lines and a final blank line inside the preserved raw Sol report. The same three-file `git diff --quiet` against old publication exits 0, proving these bytes were inherited intact. They are intentional Markdown hard-break/report-preservation bytes, not a new security or gate change. I did not rewrite the authentic report or claim a clean whole diff.
- Queried live PR #782: its remote head is still `5a82e30c7c3207b454545144bd3658a0ad5827df`, with cancelled checks on that older head. They cannot establish required exact-publication CI for local candidate `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`.

**Tests run here:** no suites, database, Docker, image, browser, or runtime test. This is a Git-object and source-coverage confirmation for the mechanical import; those other proofs are either bound to accepted #802 or must run on the published #782 head as applicable.

## Verdict

**CLEAR — lightweight independent Sol-tier security confirmation for exact local head `97f4772a63821bcbe3d3be4a1397afffa3f76a5d`.** No blocking finding. The accepted-main import preserves the reviewed PR-specific contract and report bytes and introduces no new authority or gate semantics beyond accepted main. Non-blocking: inherited raw-report Markdown whitespace and the previously recorded self-row runtime precision caveat. Residual gates: publish the exact candidate and obtain required GitHub checks on that exact remote head, then use the normal protected merge flow. This verdict does not accept P4/#47, #783/#784, runtime behavior, or stage completion.


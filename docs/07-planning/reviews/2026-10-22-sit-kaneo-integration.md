# SIT Kaneo integration — independent review

Date: 2026-10-22. Reviewer: independent Codex review session
`review_completion_directive`; not the implementing session.

Reviewed source: `109e3a73fc8ace80bb853d2eec006187e15db69c` against
`90973b7e04919732d6afa9878ed68fd7e81d703a`.

## Standard review — APPROVE (source only)

The aggregate repair retains Kaneo components and project surfaces, restores canonical
calendar/timeline reads and writes, adds the shared customer shell and approval journey,
and repairs audit URL handling. Generated portal route metadata agrees with the authored
approval route. Final documentation and formatting introduce no additional source blocker.

Resolved findings:

- Seed callers now supply and transfer a private credentials file; passwords are no longer
  hardcoded, and existing private credentials can be reused on a rerun.
- Canonical filter meaning survives project view switches and cursor-paged schedule search.
- Schedule rows receive assigned labels from a bounded workspace/project-scoped projection.
- Date writes select the maximum displayed, cached and recorded version.
- Diagnostic screenshot capture uses a separate output directory, preserving original
  comparison failures; the structural guard rejects removing that separation.

## Security review — APPROVE (source only)

Reviewed authorization, tenant scope, credential handling, customer cache isolation and CI
gate integrity. Customer queries and invalidations are identity-scoped; the shared layout
remounts on identity change. Successful password, TOTP and backup-code authentication clear
the QueryClient before navigation, closing the cross-customer cached-data exposure.
Project writes retain server permission checks and optimistic concurrency. SIT deployment
uses the existing digest/signature verification path. Diagnostic candidates cannot satisfy
G8, commit baselines or erase the original failure output. No open source blockers remain.

## Evidence and limits

The reviewer independently ran 36 tests across portal authentication, approvals, catalogue,
requests, submission detail and hierarchy URL validation: all passed. An earlier independent
32-test run covered schedule/filter/version/audit repairs. Deployment shell syntax passed.
All 428 contrast-pair tokens, themes, categories and thresholds remain unchanged.

Required exact-head hosted CI, actual reviewed Linux G8 baselines, PostgreSQL integration,
complete real API/browser journeys and shipping-image build/boot evidence remain pending.
The reviewed repair is not deployed. Reported live credential rotation and current VM
health are implementing-session evidence, not independent runtime verification here.
The running image's unknown source revision does not establish acceptance of this commit.

This record approves source, not merge, deployment, feature completion or P0–P4 completion.
Thomas's SIT walkthrough and stage sign-off remain outstanding.

## Post-CI delta — 2026-10-22

Reviewed `a3bc0cc5c3b62063c8a9471f417b8897d096eabf` against `f335fdfa`.
**Standard source review: APPROVE. Security source review: APPROVE.** No open
source blockers remain in this delta. Realtime ownership removes the duplicate legacy
connection/notice; stable project framing and UI-only preloading preserve authentication
before data access. Dialog padding, distinct selector names and direct BigInt-compatible
activity equality retain behavior. The matched Storybook 10.6.2 patch updates address the
published advisory without security-disable flags. The reviewer independently ran another
23 targeted tests: all passed.

The TaskDesk-only ingress preserves socket-source Cloudflare restrictions, exact Traefik
peer trust and normalized forwarding headers. The stale application-address finding is
resolved by a shared upstream with Docker DNS re-resolution. Reported isolated candidate
syntax/readiness and trusted/untrusted IPv4/IPv6 checks are implementing-session evidence;
the candidate was removed without changing live routing.

The reviewer viewed and approved five Linux candidates: portal home, requests, selected
catalogue form, submission detail and work-item detail. Committed PNGs are byte-identical
to those inspected candidates. Approval does not extend to portal-approvals, instance-audit
or project-backlog candidate images invalidated by subsequent fixture/layout corrections.

G8 still requires the missing reviewed approval/audit baselines and a final hosted pass.
G11, exact-image verification and complete real journeys remain pending; earlier failing
performance measurements are not superseded by native calibration failure. Live client-IP
attribution, forgery/direct-origin rejection, application-IP-change recovery, uploads,
WebSockets and CSRF remain required before topology acceptance. No new application code
or ingress topology is accepted as deployed by this review; no P0–P4 stage is complete.

## Calendar accessibility and remaining baselines — 2026-10-22

Reviewed `f6989aac85c511b414a339f254bfdc5dba4cd65e` against `3a863039`.
**Standard source review: APPROVE. Security source review: APPROVE.** The calendar
uses the existing UI ScrollArea with a localized month region name. Its browser regression
focuses the actual viewport, presses ArrowDown and requires increased scrollTop before
the unchanged accessibility assertion. No lint suppression or gate relaxation was added.
Only contrast occurrence bindings in groups 2, 3, 16 and 17 changed for the wrapper;
independent comparison confirms all 428 pair semantics, thresholds and themes are unchanged.
The implementing session reports all seven project accessibility browser cases and final
build/type/lint/contrast checks passed; these reports do not replace hosted acceptance.

The reviewer viewed and approved these seven fresh Linux candidates: portal approvals,
instance audit, work-item list, work-item table, work-item board, project backlog and project
overview. Each committed PNG was independently verified byte-identical to its inspected
artifact in `/tmp/taskdesk-889-linux-candidates2`. These supersede the earlier withheld
candidate-image approval for the corrected approval, audit and backlog captures.

Prior-head PostgreSQL shard passes are not exact-head completion evidence. Final G8
comparison, valid G11 measurements, exact-image verification and live topology tests remain
pending. Unstable calibration with 21 unrun tests is not a performance pass. Source and
baseline approval do not establish deployment, full feature completion or stage sign-off.

## Cold-load and bundle accounting delta — 2026-10-22

Reviewed `8c497ddfefb2b1006c5a6bb4489defcf8aed8a5d` against
`1db85887b245ef46431b5d7d31dda03d69c9e3ac`.
**Standard source review: APPROVE. Security source review: APPROVE.** Aggregate source
coverage extends from accepted main `a99483a7befd97d91dce5853b428dc6994d74aca`
through this exact head, including the original six Antigravity commits through `90973b7e`.
Those original changes were covered by the initial aggregate audit and subsequent repairs;
they are not excluded by the intermediate bases recorded above. No open source blockers.

The HTML preload includes the restored header's static closure without executing protected
data access. Mobile navigation loads on mobile instead of adding its hidden desktop graph.
The bundle gate now counts the preloaded closures and worst selected slim locale plus the
English fallback, deduplicating shared assets. The reviewer's fallback-accounting finding
is resolved: corrected size is 346,917 bytes against the unchanged 350,000-byte limit.
No bundle-budget waiver is approved. The reviewer independently reran all 11 bundle tests;
all passed. The implementing session reports nine browser cases, build/type/lint, all 428
contrast pairs and 47-case visual-scope validation passed; this is not a hosted G8/G11 pass.

Prior-head hosted evidence included 159 browser tests and shipping-image success, but G11
still failed LCP at 3838 ms (21/22 checks passed). The new cold-load change has not yet
passed hosted measurement. A separate local diagnostic completed several captures then
failed a board-selection timeline bound; it is not a passing diagnostic. Live ingress
observations remain attributed to the implementing session. Exact-head CI/image evidence,
integrated runtime acceptance and Thomas's P0–P4 sign-off remain outstanding.

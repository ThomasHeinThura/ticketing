# PR #508 — notification contracts security review

**Reviewer:** GPT-6 Sol, fresh independent context; did not author, direct, remediate, or prepare this candidate or its ordinary reviews.
**Reviewed head:** `b42bb1d34590718b3e5983a024b5aa2b53c966c0`
**Comparison base:** `c4475d93f98384c79370a4383bad82df75ebb31e` (accepted `main` base)
**Verdict:** **CLEAR for the documentation security contract at this exact head.** No blocking or new non-blocking security findings.
**Review:** [Full GPT-6 Sol security review](https://github.com/ThomasHeinThura/ticketing/pull/508#issuecomment-5930650450)

## Scope

Reviewed the cumulative 15-document diff (944 insertions, 122 deletions). This is a documentation-only contract change: no runtime code, migration, or screen changed. Because the documents define notification authority, fan-out, delivery and retention, this received a full security review.

Read `AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, the current status and newest decision-log entries, SDLC/coding standards, the owning notification review section, the live PR head/base/check status, and the notification feature spec. Examined the changed architecture, API, event, data-model, background-job, security, multi-tenancy, data-protection, portal, God Mode, screen-inventory, testing and configuration contracts.

Adversarial review covered one parent event per `DomainEvent.id`; atomic originating-transaction fan-out; closed resource mappings and customer visibility; event-time recipient and digest selection versus current send-time reach/preferences; digest partition/window/sealing/bounded payload; cross-child and cross-group reservations; post-lock PostgreSQL wall-clock lease and dedupe cutoffs; same-child token renewal and stale-token takeover; direct and digest durable pre-provider attempt authorization, six-call limits across crashes, and at-least-once acceptance; group/member terminal outcomes; quiet-hours deferral; child/group/parent and inbox retention; person, recipient-organisation, source-organisation, and resource-owning-organisation holds including unresolved owners; export, hard deletion, and FK/unique-key ordering. The decision log and ordinary-review findings were cross-checked.

## Ordinary review evidence

Three independent GPT-6 Luna contexts reported clear at this exact head:

- [Luna 1/3 — current-head merge-only confirmation](https://github.com/ThomasHeinThura/ticketing/pull/508#issuecomment-5930609259). This context had previously reviewed the source and the bounded attempt-budget remediation, then confirmed the merge-composed head's only delta was `docs/07-planning/status.md`; the reviewed notification contract files were unchanged.
- [Luna 2/3 — full ordinary review](https://github.com/ThomasHeinThura/ticketing/pull/508#issuecomment-5930580161). Reported no blocker; its P2 screen-inventory stage observation is resolved by the owning feature header `P4 (in-app inbox in P1)`, as the Sol review independently confirmed.
- [Luna 3/3 — full ordinary review](https://github.com/ThomasHeinThura/ticketing/pull/508#issuecomment-5930627661). Reported no blocking or non-blocking findings.

## Checks actually run by GPT-6 Sol

- `git diff --check c4475d93f98384c79370a4383bad82df75ebb31e...b42bb1d34590718b3e5983a024b5aa2b53c966c0` — PASS.
- `pnpm check:vocabulary` — PASS; all 73 declared tables registered, baseline notes unchanged.
- `pnpm check:reviews` — PASS; customer-portal, god-mode and notifications owning review sections empty.
- `pnpm check:events` — PASS; 31 published keys registered across 390 source files.
- `pnpm check:env` — PASS; 32 environment reads attributable to the configuration reference, baseline notes unchanged.
- Live `gh pr view 508` confirmed the reviewed head and base. At Sol inspection the PR-template/security-review check was failing because review evidence had not yet been recorded, and PostgreSQL integration was in progress. Those observations are not review findings; verify current required checks separately.

No runtime build, database integration suite, or browser test was run. The specification explicitly leaves fan-out, leases, retries, digest sending, retention jobs, and acceptance tests unimplemented.

## Findings and residuals

No blocking or new non-blocking security findings. The P2 raised by Luna 2 about the `/agent/notifications` inventory row is addressed by the owning feature's explicit stage declaration `P4 (in-app inbox in P1)`; this is not a waiver or a runtime-acceptance claim.

The specified provider boundary remains at-least-once after ambiguous acceptance: a retry can duplicate an external message because provider acceptance cannot be rolled back. Durable pre-provider authorization caps each direct child or digest group at six starts, and current reach is rechecked for each new call. The documents do not promise exactly-once delivery. Runtime implementation and integration/browser acceptance remain outstanding. Webhook findings and P3 identity findings remain open outside this notification review section.

This is the per-PR GPT-6 Sol security review only. It is not CI clearance, merge approval, runtime acceptance, or the P4 phase finalizer.

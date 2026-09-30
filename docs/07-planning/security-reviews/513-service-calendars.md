# Security review — service calendar management (#513)

**Reviewed head:** `41c0c8605d3c7d4c1da019f3779ebd4eeba6f205`

**Reviewer:** Independent GPT-6 Sol context `/root/p2_513_sol_security`.
**Verdict:** CLEAR for security at the reviewed code head; no blocking finding.
**Full review:** https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920072137 at `7b408df6f51fb281cd092650720e7ec02f1230ab`.
**Exact-head delta confirmation:** https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920238554 at `41c0c8605d3c7d4c1da019f3779ebd4eeba6f205`.

## Scope and evidence

The full Sol pass inspected calendar routes, workspace and role reach, API-key
scope and actor attribution, event and audit writes, timezone validation,
schema and migration `0079_service_calendar`. It ran PostgreSQL calendar
integration tests (15/15), calendar domain tests (66/66), route-policy tests
(83/83), `check:events`, a Drizzle schema-drift check, and `git diff --check`.
The reviewer found no blocking security issue. API-key PATCH actor attribution
has no focused regression test; that is recorded as nonblocking.

The later ordinary Luna review at
https://github.com/ThomasHeinThura/ticketing/pull/513#issuecomment-5920228733
and the Sol delta confirmation checked the merge from `main` at
`9e3e8860b1b2060bbb11d78629d3ae879fcbb4f1`. It added only
`docs/07-planning/status.md` and the deterministic workspace-slug test;
calendar source, schema, migration and contract are unchanged from the full
Sol-reviewed head. The Sol reviewer rechecked the exact candidate SHA and
`git diff --check` passed.

## Residuals and merge gate

CAL-8 affected-item count remains blocked on issue #437 and the missing SLA
policy. AU-14 alerting and instance-administrator notification infrastructure
are incomplete. Direct DELETE remains withheld pending the approved
pending-action route. Runtime outbox delivery and calendar usage/counts are
outside this bounded candidate.

This note records the security verdict, not phase completion or merge
clearance. At the exact-head delta review, the PR-template/security-review
check was red and PostgreSQL integration was in progress. Required CI,
browser evidence, and the final candidate checks remain merge gates.

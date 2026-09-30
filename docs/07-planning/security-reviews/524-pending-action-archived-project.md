# PR #524 — archived-project pending-action guard security review

**Reviewer:** GPT-6 Sol, independent of the implementing and remediation contexts.
**Reviewed head:** `df5867cc60c456ea5a8b8821e6eb5e6696336200`
**Reviewed head:** `1e8d644e2ed97b8e4f381dce0c5bb446201f5063`
**Verdict:** CLEAR for the bounded archived-project liveness guard.
**Full review:** [GPT-6 Sol review](https://github.com/ThomasHeinThura/ticketing/pull/524#issuecomment-5919272392).
**Current-head delta:** [GPT-6 Sol delta review](https://github.com/ThomasHeinThura/ticketing/pull/524#issuecomment-5919430811).
**Ordinary review:** [GPT-6 Luna source review](https://github.com/ThomasHeinThura/ticketing/pull/524#issuecomment-5919254843) and [merged-main delta](https://github.com/ThomasHeinThura/ticketing/pull/524#issuecomment-5919358539).

## Scope and result

The service's locked work-item/project lookup now requires an unarchived project in
addition to the existing live-project and live-item predicates. An archived parent
returns not found before a pending action, request outbox event, or audit row can be
created. The focused integration cases cover a live, archived, and soft-deleted
project. The change adds no route, capability, or new actor path.

The Sol delta reviewer confirmed that the merge of `main@d98baa9c` did not alter
the guard or regression file. Main's conditional archive update preserves
serialization with the service's project row lock; no security finding remained.
The independent Luna delta review reached the same source conclusion.

## Verification and limits

The orchestrator ran the focused PostgreSQL Testcontainers suite on the exact
reviewed source head: **1 file, 20 tests passed**. The Sol reviewer ran Biome
over the two changed source/test files and a diff check. The Sol reviewer did
not run a runtime test; GitHub CI and Docker smoke are checked separately for
the final candidate.

This is only the archived-project guard for the persistence slice. The service
still has no production caller. Pending-action execution, step-up, expiry,
confirmation impact, DELETE-route retrofit, outbox delivery, and AU-14 alerting
remain separate work. No screen or browser behavior changed.

## Note-only continuation

Every commit after reviewed source head `1e8d644e2ed97b8e4f381dce0c5bb446201f5063`
in this PR is restricted to this security review artifact. No source or test
file changes after that head are covered without a fresh exact-head delta review.

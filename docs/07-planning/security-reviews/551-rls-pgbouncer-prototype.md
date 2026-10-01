# PR #551 — independent GPT-6 Sol security review

**Reviewed head:** `d832dccd1d7dda5cdcf034ffc216fabfaf52357d`
**Base:** `1118552f7bbee00ba2e694a021db969dda2769da`
**Reviewer:** fresh independent GPT-6 Sol context (`/root/p0_551_d832_sol_security`); did not author, direct, or remediate this candidate.
**Verdict:** **PASS for the bounded test-only source candidate.** No blocking security finding. This is the per-PR security review, not a P0 phase finalizer or permission to merge.

## Ordinary reviews

Two fresh independent GPT-6 Luna contexts reviewed the same exact source head and each ran the dedicated test suite (1 file / 2 tests passed):

1. `/root/p0_551_d832_luna1`; [review comment](https://github.com/ThomasHeinThura/ticketing/pull/551#pullrequestreview-5379367979). It also ran the dedicated TypeScript check and scoped Biome check.
2. `/root/p0_551_d832_luna2`; [review comment](https://github.com/ThomasHeinThura/ticketing/pull/551#pullrequestreview-5379507796). It confirmed the exact-source container, scope and concurrency evidence.

Both reports record PASS with no blocking findings, state that the reviewers did not author, direct, or remediate the candidate, and bind their work to `d832dccd1d7dda5cdcf034ffc216fabfaf52357d`. Their independent comments are records of those reviews; this note does not claim that GitHub's review state is an approval.

## Scope and risk

I reviewed the complete three-file source diff at the stated head:

- `tests/rls-prototype/global-setup.ts`
- `tests/rls-prototype/rls-prototype.test.ts`
- `docs/07-planning/rls-prototype-results.md`

The change extends a disposable RLS experiment to route the prototype probe pool through a real PgBouncer 1.25.2 transaction pool. It changes no production RLS policy, migration, database schema, app request-authority wrapper, production role, route, runtime URL, or shared contract. Existing application-route and timing comparisons remain direct PostgreSQL connections. The result report explicitly makes no application-wrapper compatibility, production-adoption, or PgBouncer performance claim.

## Checks and security evidence

- Confirmed the reviewed PR #551 head and base from live GitHub metadata; each Luna report and my focused report identifies the same full source SHA.
- Ran the dedicated Vitest configuration on this exact source head with fresh real containers: **1 file / 2 tests passed**. PostgreSQL reported 18.6; PgBouncer reported 1.25.2, `pool_mode=transaction`, and `default_pool_size=1`.
- Verified the probe role is non-superuser, `NOBYPASSRLS`, and not the `work_item` owner. Complete sorted row-ID sets matched the separate handwritten valid-tenant predicate: customer A has 600 work items, 600 comments, and 602 attachments; customer B has 300 of each. Unset scope after commit, unset scope after rollback, and empty scope each returned zero rows from all three tables.
- Verified two distinct logical clients queued behind a one-server-connection transaction pool (`cl_waiting=1`, `sv_active=1`), shared the reused backend PID, and the queued B client observed `UNSET` before binding and reading only B's rows. The database reported exactly one probe backend after the concurrency check.
- Inspected setup and cleanup. The documented dedicated Vitest config runs global setup that creates a fresh UUID-named Testcontainers network, database and passwords; maps only random loopback ports; verifies network attachment, loopback hosts, owner and database before migrations/fixture SQL; and removes the containers, volumes and network on success or startup failure. The dedicated run does not consume a pre-existing `TASKDESK_DATABASE_URL` or migration URL. Inspection after the focused run found no probe-labelled containers or network.
- Inspected the two live GitGuardian Generic Password alerts and their source locations in commit `283678e1cd1642065fcb82321f45402b06a2373a`. The flagged owner and baseline password expressions append a fresh UUID per isolated run; the probe password is generated likewise. No fixed credential value or connection URL is emitted to logs, the result payload, or the report. I assess these alerts as generated disposable test-fixture values, not exposed persistent service credentials. The alerts and optional GitGuardian check remain triggered; no incident was dismissed and no gate was waived. The required `supply chain - secret scan` passed on the reviewed source SHA. GitGuardian is not one of the 17 strict required contexts reported by the live repository ruleset.
- Confirmed the exact-source required-check snapshot had the other 16 required contexts green and `pull request template + security review` failing while its note/body evidence was still absent. The optional GitGuardian check also failed. These statuses are not cleared by this review or note; all 17 required checks must pass again on the new note-only head before any readiness or merge decision.

## Security judgment and limits

The custom GUC is caller-controlled by the SELECT probe role. The test demonstrates that property and the report says trusted request authority must derive and bind scope; this RLS policy is not an independent identity boundary. This PR does not test a production GUC wrapper, an application route through PgBouncer, multi-instance pooling, failover, or runtime overhead. It does not complete P0 or the stage-level Sol finalizer.

**Non-blocking harness limitation:** database-target protection depends on invoking the dedicated Vitest configuration and its global setup. The test's `current_database()` assertion compares against the supplied URL pathname; if someone deliberately bypassed that configuration while injecting all `RLS_PROTOTYPE_*` values and valid owner credentials, that assertion alone would not establish Testcontainers provenance. With the documented command, generated isolated URLs are supplied before SQL. This is an alternate-runner limitation, not evidence that the documented path targets an external database. No source change for that future hardening is included in this reviewed candidate.

**Blocking findings:** none in the reviewed source.  
**Non-blocking findings:** the alternate-runner provenance limitation above; GitGuardian detections remain triggered as optional external check state.  
**Gate state:** this review records the exact-source Sol PASS. The note-only descendant still requires a fresh run of all required CI contexts; no old-head check is relabeled as current, no optional alert is dismissed, and no merge is authorized here.

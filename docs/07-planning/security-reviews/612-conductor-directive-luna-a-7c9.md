# Independent ordinary review: conductor/cause-based authority delta

**Exact local candidate:** `7c9f2dfb842df47659bdd15f68888299f6406441`  
**Published reviewed ancestor:** `f5969dfd85e39d034212affc1e2e62661cd98aa3`  
**Previously cleared source:** `6dddeea86260467fd93c19284e790462642c04e5`  
**Accepted base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`  
**Reviewer/provenance:** Fresh independent GPT-6 Luna ordinary review. I did not author, direct or remediate the six-file policy delta. The provided owner directive is the requested authority source. No source edits, tests, CI or runtime work were performed.

## Exact delta and checks

The local source worktree is at exact candidate `7c9f2dfb842df47659bdd15f68888299f6406441`, two commits ahead of its remote tracking branch. The delta from `f5969df...` changes exactly six files: `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/04-engineering/error-fix-loop.md`, `docs/04-engineering/sdlc.md`, and `docs/07-planning/decision-log.md`. `git diff --check f5969df..7c9f2df` produced no warnings. I read the attached directive at `/Users/heinthura/.codex/attachments/1724621a-c637-4327-b782-03270a305b0c/Pasted text.txt` and the complete six-file delta, bounded to its authority and execution implications; I did not restart review of the already-cleared unchanged policy scope.

The delta correctly codifies one owner-designated conductor for global queue/dependencies/shared resources/merge order/release/existing scheduler; lane-local bounded ownership; and continuation of genuinely independent authorized tasks while #612 is pending. It classifies failures from evidence before choosing product, test/fixture, environment/invocation, metadata or timing remedies; preserves the existing retry policy; prohibits unchanged repeated acceptance attempts; and carries the three-attempt count across versions, branches, sessions and reviewers. The runner-specific procedure calls for real CLI/launcher/arguments, artifact and source/image binding, collector call sites, serialization/reconciliation, retained-ledger replay for missing/unexpected/nullable/corrupt cases and evidence preservation before validation/cleanup. It clearly distinguishes preflight from live acceptance.

The P0 language preserves the requested boundary: pre-merge reviews, current required CI, installer regression, exact-image boot and applicable runtime/authorization proof; after eligible merge, signed-main installer/upgrade/rollback; accepted-main phase finalizer before P0 closure. It does not require a main-only signed release before otherwise eligible source merge and does not treat merge as closure. The delta explicitly preserves security, CI, test, performance, authorization, tenant-isolation and protected-branch gates, as well as existing functionality only, no automatic P4 completion, GHCR/GitHub Releases and SIT only, and no Docker Hub or production. These source changes are consistent with the supplied directive.

## Blocking handoff mismatch

**Blocking finding — durable queue still imposes a global wait.** The new policy says to continue work whose actual dependencies are met and not to wait globally for #612. However, the unchanged active queue still states:

- `docs/07-planning/integration-execution-queue.md:43`: frozen-source/dependency inventory is “ready after #612 acceptance” and says “After #612 protected acceptance” before refreshing the train/lane sources.
- `docs/07-planning/integration-execution-queue.md:94-95`: the active heartbeat “checks the control-plane PR first” and “resumes the queue automatically after acceptance.”
- `docs/07-planning/status.md:41`: that heartbeat “resumes the queue only after protected acceptance.”

The attached directive explicitly says #612 does not automatically block every integration lane, allows source conservation/conflict analysis/migration reconciliation/review/regression/release preparation to continue, and says a dependency must identify the required source/artifact/decision/result. The new policy itself says the same. The queue rows and continuation wording do not identify an authority dependency for those listed inventory/continuation actions; as written they retain the blanket wait the owner directive rejects. This needs the designated conductor's exact task/dependency and handoff reconciliation before the policy correction is operationally coherent. I did not edit queue/status or alter the scheduler because the owner directive reserves those global assets to the conductor, and the parent task explicitly assigned that handoff to the other conductor context.

This finding is limited to the current cross-document execution mismatch. It is not a request to restart policy review or to alter global ownership. The six-file delta itself otherwise accurately implements the directive.

## Live exact-source acceptance state

Read-only GitHub inspection shows PR #612 is still published at `f5969dfd85e39d034212affc1e2e62661cd98aa3`, not local `7c9f2df...`. The current published source has red required checks: latest CI-full run `37911235251` has G11 failure (`113756607515`), and latest fast run `37911237899` has dependency-audit failure (`113756623377`). Therefore there is no green published acceptance candidate. The exact local `7c9f2df...` has not been published and has no exact-head CI/review evidence; its source CI is unknown, not green. No prior green result cancels either current red check.

## Verdict

**Verdict: CHANGES REQUIRED before the control-plane correction can be treated as a coherent operational handoff.** No blocker was found in the content of the six changed policy files relative to the owner directive. The blocking item is the unchanged, conductor-owned queue/status continuation language at the exact locations above. The conductor must reconcile it with the newly accepted authority directive and report the actual dependency/owner handoff; this reviewer did not self-remediate it. Separately, current published CI remains red and the local exact candidate has not been checked, so neither is merge-eligible. No tests or runtime verification were appropriate for this policy-document review, and no gate was waived.

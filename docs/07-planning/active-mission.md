# Active mission

The single record of **what agents are currently authorized to do**. It selects the operating
mode defined in [agent-workflow.md § Operating modes](../04-engineering/agent-workflow.md#operating-modes).
Permanent policy files never restate it; they link here.

Only a new explicit decision by Thomas changes this file. The conductor or a policy maintainer
Thomas assigned edits it, records that decision in the [decision log](decision-log.md) in the
same change, and takes the agent-authority review tier. Replacing the mission also re-decides
the security-review model block in
[agent-workflow.md § Model policy](../04-engineering/agent-workflow.md#model-policy). Task state does not belong here — it
belongs in the conductor's queue (`docs/07-planning/integration-execution-queue.md`).

---

## Current mission — Integration Freeze and SIT Consolidation

**Authorized by:** Thomas, decision log 2026-10-09 (Integration Freeze; Conductor Coordination
& Delivery; Workflow and agent-policy restructure).

**Active mode:** Integration freeze, then Release and SIT verification. Policy maintenance runs
alongside as its own bounded task. Feature development is **inactive**.

**Sequence:**

1. Freeze new feature scope.
2. Integrate valid existing work onto accepted `main` (conflict resolution, security
   remediation, regression fixes, acceptance repairs).
3. Verify accepted `main` at the required gates.
4. Publish the accepted artifact through GHCR, GitHub Releases, tags and GitHub Packages
   where applicable.
5. Deploy the exact published digest to SIT and verify complete workflows and recovery.
6. Complete the independent audit.
7. Report to Thomas and **enter Hold** — await the next owner roadmap.

**In scope:** functionality that already exists on a branch or PR, and the integration,
acceptance, security, correctness, performance and accessibility fixes needed to verify it
against approved contracts.

**Out of scope:** any unimplemented roadmap item; automatic completion of P4–P7; a missing
product decision treated as an acceptance fix; Docker Hub publication; production deployment;
a new release path, version exception or tag scheme.

**Environments:** local and disposable runtimes for verification; SIT for runtime acceptance.
No production.

**Conductor:** the single session Thomas designates (decision log). It owns the queue,
dependency graph, shared resources, migration allocation, merge order, release coordination
and the one continuation mechanism. A policy maintainer Thomas assigns owns only its policy
candidate and its handoff.

**Model assignment for this mission** (decision log 2026-10-09, "Model tiers by
availability"): use whichever model in the tier is available. **Sol tier** (security and
critical review, phase finalizer, final audit): GPT-6 / GPT-6.1 Sol or a fresh Claude Opus
context. **Luna tier** (implementation, ordinary review): GPT-6 Luna, Claude Sonnet or Claude
Haiku. A Sol-tier model may fill a Luna-tier role when no Luna-tier model is available, never
the reverse. The conductor is the session Thomas designates. Every role is a separate, independent
context, at the review depth and counts the workflow requires, labelled with the model that
actually produced it. Reviews completed under earlier assignments stay valid for what they
covered. See
[agent-workflow.md § Model policy](../04-engineering/agent-workflow.md#model-policy).

**Stop condition:** final integrated SIT acceptance plus independent audit are recorded and
reported. The conductor then sets every remaining queue item to a waiting or terminal state
and stops. It does not start new roadmap work.

**Formal stage closure:** an accepted integrated slice is not P0–P7 completion. Stage closure
keeps its own [stage gate](../04-engineering/definition-of-done.md#stage-completion) and is not
automatic under this mission.

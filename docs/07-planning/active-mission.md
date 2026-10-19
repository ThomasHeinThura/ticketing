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

## Current mission — PR Consolidation, Integration Freeze, and Verified Main

**Authorized by:** Thomas, orchestrator directive 2026-10-19 (Antigravity Orchestrator Directive;
PR Consolidation and Verified Main).

**Active mode:** Integration freeze, PR consolidation, verification of accepted `main`, then HOLD.
Policy maintenance runs alongside as this bounded bootstrap task. Feature development is **inactive**.

**Sequence:**

1. Freeze the starting PR inventory.
2. Repair and integrate existing PR functionality onto accepted `main` (Carrier C, component PRs,
   query-ownership and activity contracts).
3. Retire verified predecessor, duplicate, and diagnostic PRs with clear evidence.
4. Verify accepted `main` at the required candidate gates.
5. Report completion to Thomas and **enter Hold** — await the next owner instruction.

**In scope:** functionality that already exists on a branch or pull request in the frozen starting
inventory recorded in the decision log, and the integration, acceptance, security, correctness,
performance and accessibility fixes needed to verify it against approved contracts.

**Out of scope:** any unimplemented roadmap item; automatic completion of P4–P7; a missing
product decision treated as an acceptance fix; release publication through GHCR, GitHub Releases,
tags or Docker Hub; persistent SIT, UAT or production deployment; external identity provider or
notification channel activation; broad recovery exercises; formal P1–P7 stage finalization audits;
a new release path, version exception or tag scheme.

**Environments:** local and disposable runtimes for verification. No persistent SIT deployment,
UAT or production.

**Conductor:** the Antigravity session Thomas designates (decision log 2026-10-19). It owns the
queue, dependency graph, shared resources, migration allocation, merge order, and verification.

**Model assignment for this mission** (decision log 2026-10-19):
- Orchestrator and difficult cross-module diagnosis: **Gemini 4 Argon**
- Bounded implementation, test repair and ordinary review: **Gemini 3.8 Flash**, in separate contexts
- Critical/security review: fresh **Gemini 4 Argon** or available **Claude Opus** context
- Higher-risk implementation when necessary: Argon or Opus, with a different independent reviewer

Every role is a separate, independent context, at the review depth and counts the workflow requires,
labelled with the model that actually produced it. Reviews completed under earlier assignments stay
valid for what they covered. See
[agent-workflow.md § Model policy](../04-engineering/agent-workflow.md#model-policy).

**Stop condition:** all starting PRs and necessary successors have a valid terminal disposition
(merged, absorbed/superseded, or diagnostic-retired), required integration and candidate checks pass
on accepted `main`, and the mission enters **HOLD — awaiting Thomas's instruction**. The conductor
does not automatically proceed to release publication, persistent SIT deployment, recovery exercises,
or the next roadmap stage.

**Formal stage closure:** an accepted integrated slice is not P0–P7 completion. Stage closure
keeps its own [stage gate](../04-engineering/definition-of-done.md#stage-completion) and is not
automatic under this mission.

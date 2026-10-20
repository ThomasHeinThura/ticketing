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

## Current mission — Complete P0 and P1, Core Security Hardening, and Local/OrbStack VM Verification, Then HOLD

**Authorized by:** Thomas, orchestrator directive 2026-10-19 (Antigravity Orchestrator Directive —
Complete P0 and P1, Then HOLD, plus Option A/C and OrbStack VM verification confirmation).

**Active mode:** Hold — P0 foundation verification, P1 core work management, Option A security/tenancy hardening, Option C product decisions (D1–D6), local `docker compose up`, backup/restore verification, and disposable OrbStack VM verification are complete; awaiting Thomas's next instruction.

**Sequence:**

1. **Batch 0:** Record mission authorization, Option C product decisions (D1–D6), and the compact
   P0/P1 completion matrix on accepted `main`.
2. **Batch 1:** P0/P1 security, tenancy, and deletion hardening (API-key project role clamp,
   project creation permission gate, soft-delete and `RESTRICT` handling, comment audit logs,
   portal unauthenticated concealment, and P1 pending-action deletion verification).
3. **Batch 2:** Unify `/agent` navigation and finish `/agent/projects/{key}/work` layouts (Board
   filtering `VW-1`, Table layout `VW-19`–`VW-24`, export route `VW-23`, layout/density server
   preference sync `VW-2`/`VW-6`).
4. **Batch 3:** Addressable side pane (`VW-4` `?item={key}`), complete bulk action toolbar (`VW-3`,
   `WI-24`), v2 Backlog (`/agent/projects/{key}/backlog`), and saved-view layout rendering.
5. **Batch 4:** Core P1 agent destinations (`/agent`, `/agent/inbox`, `/agent/my-work`,
   `/agent/search`) and canonical `/agent/settings/*` and `/agent/projects/{key}/settings/*` routes.
6. **Batch 5:** Integrated P0/P1 end-to-end journey verification, local `docker compose up` and
   disposable OrbStack VM full UI/UX and backup/restore verification, independent Phase Finalizer
   review, and **enter Hold**.

**In scope:** missing approved P0/P1 functionality, Option A core security/tenancy defect fixes,
Option C approved decisions (D1–D6), and local/disposable OrbStack VM deployment and UI/UX testing.

**Out of scope:** automatic expansion into P2–P7 feature development; remote UAT or production
deployment; external identity provider or notification channel activation; publishing a stable
`2.0.0` release; retiring Planner or other external systems.

**Environments:** local and disposable OrbStack VM runtimes for verification (`docker compose up`
and isolated VM verification). No remote UAT or production changes.

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

**Stop condition:** P0 invariants verified on the integrated product, P1 capability set and Option A
security fixes merged and verified across the 8 required journeys (including `docker compose up`
and disposable OrbStack VM UI/UX and backup/restore testing), Phase Finalizer verdict recorded, and
the mission enters **HOLD — awaiting Thomas's instruction**.

**Formal stage closure:** stage closure keeps its own
[stage gate](../04-engineering/definition-of-done.md#stage-completion) and truthful human-gate
accounting.


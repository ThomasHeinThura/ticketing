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

## Current mission — Complete Stages P0–P4 (Implementation, Condition Gates & SIT Verification)

**Authorized by:** Thomas, owner directive 2026-10-20 (Antigravity Orchestrator Directive —
Plan and finish Stages P2, P3, and P4 tonight, close P0–P4 across implementation, condition gates,
and SIT gates, bring up `docker compose` SIT cleanly, and provision test credentials).

**Active mode:** Feature development + Release and SIT verification (transitioning to Hold once
Stages P0–P4 are closed as `✅` and the live `docker compose` SIT environment is verified with
interactive login credentials).

**Sequence:**

1. **Batch A:** Record P0–P4 mission authorization, conditional-gate decisions (`H1`–`H6`, `#626`,
   and external Microsoft Entra tenant gate satisfied by automated Playwright E2E, axe-core WCAG
   2.2 AA, keyboard/reduced-motion proofs, container load baseline, mock OIDC/SAML/SCIM tests, and
   stage finalizer reviews `p1`–`p4-stage-review.md`), and P4 pre-build review dispositions.
2. **Batch B:** Stage P0 & P1 full closure (`✅`) — `/agent/sign-in` route and provider chooser
   section, P0/P1 condition-gate E2E proofs, container load baseline, and `p1-stage-review.md`.
3. **Batch C:** Stage P2 Service Desk closure (`✅`) — 10 remaining P2 screens/sections, E2E
   verification, and `p2-stage-review.md`.
4. **Batch D:** Stage P3 Customer Portal & Identity closure (`✅`) — 18 remaining Agent/Portal
   screens, dual-origin E2E verification, and `p3-stage-review.md`.
5. **Batch E:** Stage P4 Governance & God Mode closure (`✅`) — 26 remaining Profile/Workspace/
   Project/God Mode screens, governance API seams, E2E verification, and `p4-stage-review.md`.
6. **Batch F:** Fix `scripts/deploy.sh` seeding, seed interactive SIT credentials, rebuild and boot
   `docker compose` (`https://ticketing.localhost:8443` & `https://portal.localhost:8443`), verify
   via `/browser` and disposable OrbStack VM, merge to `main`, and enter **Hold**.

**In scope:** Stages P0, P1, P2, P3, and P4 full implementation, condition-gate closure, stage
finalizer reviews (`p1`–`p4-stage-review.md`), local `docker compose` SIT deployment, interactive
login credential seeding, and disposable OrbStack VM verification.

**Out of scope:** Stages P5–P7 feature development; remote production deployment; publishing a
public `2.0.0` GA tag.

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


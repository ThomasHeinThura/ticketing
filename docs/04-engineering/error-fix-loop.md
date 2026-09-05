# Error fix loop

Stage 7 of the [SDLC](sdlc.md). How to fix something without making it worse, and when to
stop trying.

## The loop

```
        ┌──────────────────────────────────────┐
        ▼                                      │
   Reproduce  →  Understand  →  Fix  →  Verify ─┘ (if not fixed)
                                          │
                                          ▼
                                   Guard  →  Record
```

Every step in order. The most common failure is skipping **Understand** and going straight
from a symptom to a plausible change.

---

## 1 · Reproduce

You cannot fix what you cannot reproduce. If it only happens sometimes, that *is* the bug —
find the condition.

- Write a **failing test first**. It reproduces the problem, it proves the fix, and it
  prevents the regression. Three jobs for one artefact.
- Capture the exact conditions: role, data, browser, timing, concurrency.
- If reproduction takes more than thirty minutes, that is information: the system is hard
  to observe, and that is worth fixing too.

## 2 · Understand

**Find the cause, not the symptom.**

Ask "why?" until you reach something structural:

> The board shows a stale card.
> — *Why?* The query was not invalidated.
> — *Why?* The WebSocket message carried a different key shape.
> — *Why?* The broadcast used `id` where the query key uses `key`.
> — *Why?* Nothing enforces that broadcast payloads match query keys.

The last answer is the one worth fixing. Patching the first produces a fix that works and
teaches nothing.

**Do not change code until you can say, in one sentence, why it is broken.**

## 3 · Fix

- The smallest change that addresses the cause.
- Do not refactor while fixing. Two changes in one pull request means neither is reviewed
  properly.
- Do not fix adjacent things you noticed. Note them, open issues, move on.
- If the fix reveals the spec was wrong, **update the spec** and re-enter at SDLC stage 3.

## 4 · Verify

Re-run from the earliest stage the change could have affected:

| Change touched | Re-run from |
| --- | --- |
| `packages/domain` | Stage 4 — unit |
| An API route | Stage 5 — integration and permissions |
| A UI component | Stage 6 — UX gates |
| The schema | Stage 4, with a migration test |

Then **open the thing and use it**. Automated verification is necessary and insufficient —
v1's worst defects were all green.

## 5 · Guard

If the bug was an instance of a *class*, add something structural so the class cannot
recur.

Precedents already in this project:

| Bug class | Guard |
| --- | --- |
| A route with no permission check | Route policy coverage test |
| A screen with no URL | Route registry round-trip test |
| A bespoke UI primitive | Lint rule (G1) |
| A hard-coded colour | Token check (G2) |
| Cross-tenant leak | Tenant isolation test |
| Internal comment leaking to the portal | Separate portal router plus a named test |

A guard is worth far more than a fix. A fix closes one hole; a guard closes the shape of
the hole.

## 6 · Record

- Root cause stated in the pull request. Not the symptom — the cause.
- If the lesson generalises, add it to the **Lessons** section below.
- If it changed a decision, add a [decision log](../07-planning/decision-log.md) entry.

---

## The three-attempt rule

**After three failed attempts at the same problem, stop.**

Write down:

1. What is happening, precisely.
2. What you expected.
3. The three things you tried and what each produced.
4. What you have ruled out.
5. Your current best hypothesis.

Then escalate to Thomas.

This applies especially to AI agents, where the failure mode is generating variation after
variation without new information. A fourth variation on a wrong model of the problem is
not progress, and the fifth will not be either. The rule converts a spiral into a
conversation.

---

## Anti-patterns

| Don't | Why |
| --- | --- |
| Disable the failing test | You have hidden the bug, not fixed it. Never acceptable |
| Add a `try/catch` that swallows | The error was information; you deleted it |
| Add a `setTimeout` to "let it settle" | You have made it slower and still racy |
| `as any` to silence the compiler | The compiler was right |
| Widen a permission to make it work | You have created a security bug to fix a UX one |
| Revert someone else's guard | Ask why it exists first. It exists because something went wrong |
| Fix the symptom and move on | It will come back, in a different shape, later, worse |
| Keep going after three failures | See above |

---

## When a build fails in CI

1. **Read the actual error.** Not the summary — the error.
2. Reproduce locally with the same command CI ran.
3. If it fails locally, it is a real failure. Fix it.
4. If it passes locally, it is an environment difference: timing, data, ordering,
   parallelism, timezone. Those are the usual suspects, in that order.
5. If it is flaky, **fix the flake**. Do not retry the job. A suite with known flakes
   stops being trusted, and then a real failure gets retried too.

---

## Lessons

Add to this as things are learned. It is the institutional memory that agents do not have.

### From v1

- **Green tests proved nothing about authorization.** Eleven holes shipped past a full
  suite, because a test only fails for behaviour someone thought to assert. The answer is
  structural: policy coverage and a permission matrix.
- **"It looked fine" was not verification.** Four active buttons rendered with empty icon
  paths. Icons must be imported directly so a missing one is a compile error.
- **Display-name comparison collided.** Compare identities by id, always.
- **Fire-and-forget notifications hid failures.** An outbox with visible delivery history
  is the correction.
- **Bundle separation created false confidence.** "It isn't in the customer bundle" is not
  a security argument.

### From v2

*(Add as encountered.)*

## Related

- [SDLC](sdlc.md) · [Testing strategy](testing-strategy.md)
- [Agent workflow](agent-workflow.md)

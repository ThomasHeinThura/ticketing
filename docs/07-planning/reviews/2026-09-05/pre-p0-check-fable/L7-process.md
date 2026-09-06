> **Audit trail only — not a stage-2 gate section.** Every row below was applied in its owning document or recorded in the decision log on 2026-09-06 (see decision-log.md "Pre-P0 check applied"). Line numbers refer to the documents as they stood on 2026-09-05, before those edits.

# L7 — Engineering process review: enforcement and contradictions

Lens: for every rule that governs agents, is it enforced by a mechanism (CI step, test, PR
template field, branch protection, script) or is it prose an agent can route around? And
where do the process documents contradict each other or the rest of the corpus?

Repo: /Users/heinthura/Documents/Workfolder/Development/Ticketing.v2 (docs only, no code yet).

| severity | file:line | rule / claim | enforcement today, or contradicting file:line | concrete fix |
| --- | --- | --- | --- | --- |
| high | `docs/04-engineering/ci-cd.md:83` / `docs/01-architecture/security-model.md:436` | "The Opus **security review** is a required PR-template section, checked non-empty by CI" ; "Opus security review \| PR template, phase gate" | **The PR template does not exist anywhere in the corpus.** Grep for `pull_request_template`, "PR template", `.github/` returns only these two forward references plus the review finding that asked for it (`docs/07-planning/reviews/2026-09-05/architecture-engineering-ops.md:131`). No document defines its fields, its path, or who creates it; `repository-bootstrap.md` does not list it as a P0 deliverable. Every model-tier and evidence rule in the corpus terminates in this non-existent file. | Write `.github/pull_request_template.md` **and** describe it in `docs/04-engineering/definition-of-done.md` as the single authoritative field list: spec id + rule numbers in scope, `Implemented-by:` model, `Reviewed-by:` model, `Security-reviewed-by:` model + findings, screens opened (URL, viewport, screenshot), DoD checklist, waiver (gate + Thomas approval + follow-up issue). Add it to `repository-bootstrap.md`'s P0 step list so it lands before the first PR. |
| high | `docs/04-engineering/agent-workflow.md:70-97` | "Review — security \| **Opus. Always. Not optional, not cost-negotiable.**" and "Implementation subagents … **Sonnet 5**" | **Prose only.** Nothing anywhere records which model implemented, which reviewed, or which did the security pass. There is no PR field, no label, no commit trailer, no CI check. An agent can run every subagent on Sonnet, self-review, and write "reviewed on Opus" in a report with nothing able to contradict it — the exact v1 failure (declaring things done that were not), moved one level up into the review layer. | Three required PR-template fields (`Implemented-by`, `Reviewed-by`, `Security-reviewed-by`) plus a CI check that all three are non-empty, that `Reviewed-by` names a different session/model from `Implemented-by`, and that `Security-reviewed-by` matches `^Opus`. Machine-checkable strings, not sentences. |
| high | `docs/04-engineering/agent-workflow.md:84` vs `docs/04-engineering/sdlc.md:117-120` vs `docs/04-engineering/ci-cd.md:83-85` vs `docs/01-architecture/security-model.md:436` | "**Every pull request** and every phase gate gets an explicit, separate security-focused pass on Opus" | Four different scopes for the same rule. sdlc.md:119-120 narrows it to "anything touching auth, reach/authority, secrets, uploads, webhooks or a new route"; ci-cd.md:84-85 narrows it further to a CI trigger on `apps/api/src/{middleware,plugins}/**`, `packages/permissions/**` or any `policy.ts`; security-model.md:436 says "Every PR touching security surfaces". The CI trigger — the only actual mechanism — **misses uploads, webhooks and new route files** that sdlc.md explicitly names, since a new feature folder's routes live in `apps/api/src/<feature>/` and its `policy.ts` would match but an upload handler or webhook sender would not. | Pick one scope and make ci-cd.md's path globs the authority. Widen them to `apps/api/src/**` plus `packages/permissions/**`, `packages/plugins-contracts/**` and any `*/policy.ts`, and have agent-workflow.md, sdlc.md and security-model.md cite `ci-cd.md#pull-request-pipeline` instead of restating a different list. |
| high | `docs/04-engineering/definition-of-done.md:60` | "Built on a Radix primitive where one exists" | **Contradicts the locked decision.** `docs/07-planning/decision-log.md:38` — decision N — "**Base UI is the primary primitive standard**; migrate Radix where an adequate equivalent exists; retained Radix in `KNOWN-RADIX.md`, enforced by `check:ui`". The enforced mechanism (`ci-cd.md:38-40`, `testing-strategy.md:296-298`) fails the build on "any Radix primitive inside `packages/ui` not listed in `KNOWN-RADIX.md`". So an agent following the DoD checklist verbatim builds on Radix and is rejected by CI — or, worse, adds itself to `KNOWN-RADIX.md` to get green. | Replace line 60 with: "Built on a **Base UI** primitive. Radix only where Base UI has no adequate equivalent, and only with an entry in `KNOWN-RADIX.md` giving the reason — `check:ui` fails otherwise (decision N)." |
| high | `docs/04-engineering/definition-of-done.md:22-35, 72-92` | Backend change and New feature checklists | **No security-review checkbox exists in either list.** The 2026-09-05 review asked for exactly this: `docs/07-planning/reviews/2026-09-05/architecture-engineering-ops.md:131` — "add the corresponding checkbox to `definition-of-done.md`'s Backend and New feature lists". Only the CI sentence in ci-cd.md was applied; the DoD half of the fix was not. The single trace of a security review in DoD is `definition-of-done.md:132` "Security review of anything new" under Phase completion — no model tier, no artefact, no link. | Add to Backend change and New feature: "- [ ] **Opus security review** completed and recorded in the PR's `## Security review` section — surfaces examined and findings, or an explicit 'no security surface touched'". Change line 132 to cite the same section. |
| high | `AGENTS.md:128-131` / `docs/04-engineering/agent-workflow.md:200` / `docs/04-engineering/error-fix-loop.md:69` | "**And then open the screen and use it.** … *verify before you believe*" | **Prose only, in four places, with no artefact anywhere.** No PR field, no checkbox, no screenshot requirement, no CI hook. `definition-of-done.md`'s Frontend list (41-54) has thirteen boxes and none of them is "I opened it". This is the single rule the corpus says v1 died of ("four of its worst defects were invisible to a green test suite") and it is the least enforced rule in the corpus. | PR-template field `## Screens opened` — one line per screen: route, viewport, what was clicked, and a pasted screenshot. Add "- [ ] Every screen in this change opened and used; listed in `## Screens opened` with screenshots" to `definition-of-done.md`'s Frontend list. CI check: if `apps/web/**` changed, the section must be non-empty. A screenshot is cheap to produce and impossible to produce without opening the screen. |
| high | `AGENTS.md:162-163` (do-not 15) / `docs/04-engineering/definition-of-done.md:80-83` / `docs/04-engineering/sdlc.md:58-61` | "Start building a feature while its section in `docs/07-planning/reviews/2026-09-05/` is non-empty" ; "Reviewers check this box, not the author" | **Prose plus a self-ticked checkbox.** The review files are markdown tables in the repo; nothing compares a spec's build state against its review section. sdlc.md:61 asserts "reviewers check this box, not the author" but agent-workflow.md's Review section (236-241) has no mechanism binding a reviewer to that box, and the reviewer is another agent with no memory. An agent can tick it and start. | Make it mechanical: a `check:reviews` script in the fast CI stage that maps each feature spec to its section in `docs/07-planning/reviews/2026-09-05/*.md` and **fails the build if a PR touches `apps/**` for a feature whose section still contains open rows**. Findings are closed by deleting the row in the same PR that closes them, so the file empties visibly. Add the script to `repository-bootstrap.md`'s P0 list beside `check:queries` and `check:inventory`. |
| high | `docs/04-engineering/agent-workflow.md:26-28` | "Two of these are absolute: **an agent may never approve its own design review, and an agent may never waive a quality gate.**" | **Both are prose only.** Design approval (H1–H6) lives in the PR description (`sdlc.md:140-141`, `definition-of-done.md:54`) with no field identifying who answered; waivers have a four-step procedure (`docs/02-design/ux-quality-gates.md:195-204`) whose only durable trace is a decision-log entry the same agent would write. Nothing in CI or branch protection distinguishes "Thomas approved" from "the agent wrote that Thomas approved". `ci-cd.md:207` requires "one approval" on `main`, but with a one-human team an agent's PR can only be approved by Thomas *if Thomas's GitHub account is the only reviewer with write access* — which is stated nowhere. | State in `ci-cd.md#branching` that `main`'s required approval is a **CODEOWNERS rule naming Thomas's account only**, with "dismiss stale approvals" and "require review from Code Owners" on, and no bypass actors (the workflow-hardening section already uses that phrase at line 189). Add PR-template fields `Design (H1-H6) answered by:` and `Waiver approved by:` — a value other than Thomas fails the check. |
| medium | `docs/04-engineering/sdlc.md:212-229` vs `docs/04-engineering/definition-of-done.md:120-135` vs `docs/02-design/ux-quality-gates.md:149-177` vs `docs/07-planning/phases.md:24-26` | "## The phase gate — At the end of each phase, before the next begins" | **Four phase-gate lists that do not agree, and a circular pointer.** phases.md:26 and release-plan.md:141 name **sdlc.md** as the authority; sdlc.md:208 points at **ux-quality-gates.md** for "the phase gate"; ux-quality-gates.md's P1–P6 omit the load-test baseline and the security review entirely; definition-of-done.md:120-135 adds "Every screen ✅ in the screen inventory", "Full E2E suite green", "Full E2E with reduced motion", "**Backup and restore verified**" and "Roadmap and status updated" — none of which appear in sdlc.md's list; sdlc.md adds "**a phase-level security review, on Opus**" which definition-of-done.md softens to "Security review of anything new" (line 132) with no tier. An agent closing a phase from sdlc.md skips backup/restore verification; one closing it from ux-quality-gates.md skips the security review. | One list. Put it in `definition-of-done.md#phase-completion` (it is already the longest and is the document DoD-shaped work copies from), make it the superset including "phase-level Opus security review", and reduce sdlc.md:212-229 and ux-quality-gates.md:149 to a link plus the items unique to their own domain. Fix sdlc.md:208's link to point at the same place. |
| medium | `docs/07-planning/release-plan.md:101-105` | "**Gate activities consolidated**: the manual accessibility pass, fresh-eyes test, four-browser check and k6 baseline are run **once, before `2.0.0`**, over the whole surface, instead of once per phase" | **This is a blanket gate waiver granted by a planning document, and the waiver procedure was not followed.** `AGENTS.md:145` and `agent-workflow.md:22` say only Thomas may waive a gate; `docs/02-design/ux-quality-gates.md:195-204` requires the gate named, a reason, Thomas's explicit approval, a linked follow-up issue and a decision-log entry. `docs/07-planning/decision-log.md:707-711` — the Waivers section — reads "*(None yet.)*". So four phase-gate activities are already waived for every phase with no waiver record, while `phases.md:20` simultaneously says "**never skip a security, quality, test or review gate to match a calendar**". An agent reading release-plan.md concludes the phase gate is negotiable in bulk. | Either record it properly as a dated waiver in `decision-log.md#waivers` (gate, reason, follow-up, approved by Thomas) and have release-plan.md:101 link to that entry, or re-word it as a *scheduling* statement that does not touch gate content. Also reconcile it with `phases.md:20`, which currently forbids what it does. |
| medium | `AGENTS.md:107` "`pnpm test:all` # what CI runs" | Command inventory mismatch, AGENTS.md ↔ ci-cd.md ↔ testing-strategy.md | `ci-cd.md:24-25` declares itself "**the single list of CI checks**" and **never mentions `test:all`** — it lists ~20 individual commands. `testing-strategy.md:356` also says "`pnpm test:all` # everything; CI runs this". So two documents assert a script CI does not run, and the authoritative CI list cannot be derived from either. Missing from AGENTS.md but required by CI: `check:i18n`, `check:queries`, `check:inventory`, `check:bundle-purity`, `check:bundle-size`, `test:coverage`, `test:contract`, `test:mcp`, `test:a11y`, `test:perf`, `pnpm audit`, `gitleaks`, `helm lint`. Missing from testing-strategy.md's Running block (346-357): `test:a11y`, `test:perf`, `test:coverage`, every `check:*`. Missing from ci-cd.md but present in testing-strategy.md's Running block: `test:load`. | Define the scripts **once**, in `ci-cd.md`, as a table of `script → what it does → which CI stage`. Make `test:all` a real composite script that runs exactly the fast+full stage list, so "what CI runs" and "what I can run locally" are the same string. Have AGENTS.md and testing-strategy.md link to that table instead of restating subsets. |
| medium | `docs/07-planning/phases.md:57` | "UX gate scripts: `check-tokens`, `check-ui`, `check-deps`, `check-bundle-purity`" | **Hyphens, not colons.** Every other occurrence in the corpus uses `check:tokens` / `check:ui` / `check:deps` / `check:bundle-purity` (`AGENTS.md:109-111`, `ci-cd.md:37-40,56`, `testing-strategy.md:296-300`, `repository-bootstrap.md:86`, `container-image.md:80`). phases.md is the P0 deliverable list — an agent creating `package.json` from it produces four script names CI never calls, and the CI steps then fail with "script not found" or, worse, are quietly dropped. | Change `phases.md:57` to the colon form. Add the same four to `ci-cd.md`'s single script table so there is one spelling to copy. |
| medium | `docs/04-engineering/ci-cd.md:75-77` (`pnpm test:a11y`, `pnpm test:perf`) vs `docs/04-engineering/testing-strategy.md:282,290-292` | "`pnpm test:a11y` G4 — axe" / "`pnpm test:perf` G11 — budgets" | Two different designs for the same checks. testing-strategy.md:282 says axe "runs on every screen the **E2E suite visits**" (i.e. inside `test:e2e`, not a separate script) and 290-292 describes performance as assertions inside the E2E run against a seeded dataset. ci-cd.md runs them as two separate top-level scripts. Neither appears in testing-strategy.md's Running block. An agent implementing the CI file writes two scripts that do not exist; an agent implementing the tests puts them inside Playwright projects that CI never invokes separately. | Decide one shape — separate Playwright projects (`--project=a11y`, `--project=perf`) invoked by name is the cheapest — and use the identical invocation string in both documents. Also normalise `pnpm test:e2e --project=security` (ci-cd.md:72) vs `pnpm test:e2e -- --project=security` (testing-strategy.md:353) vs `pnpm test:e2e -- <scope>` (AGENTS.md:125); the `--` separator is not cosmetic in pnpm. |
| medium | `docs/04-engineering/testing-strategy.md:359-366` ("CI gating" table) vs `docs/04-engineering/ci-cd.md:22-85` | "Every pull request \| + integration, permissions, contract, MCP, E2E, visual, a11y, performance budgets" | Contradicts the document that claims sole authority. ci-cd.md:62-63 puts integration, E2E, visual, a11y and perf in the **Full** stage, which runs "on the merge queue (or on the `ready-for-review` label)" — not on every pull request. testing-strategy.md's "Release \| + load test, SBOM, migration dry-run against a production copy" also has no counterpart in ci-cd.md's Release workflow (109-113), where SBOM is a **main**-pipeline step (`ci-cd.md:96`) and neither the load test nor a migration dry-run against a production copy appears at all. | Delete the "CI gating" table from testing-strategy.md and replace it with a link to `ci-cd.md#pull-request-pipeline`, per the pointer ci-cd.md:25 already asserts exists ("testing-strategy.md links here" — it does not; it restates). |
| medium | `docs/04-engineering/agent-workflow.md:3` and `70-97` | "The team is **Thomas plus three AI agents**: an OpenAI agent, GitHub Copilot, and Claude Code" ; "## Model tiers **within Claude Code**" | The entire model-tier policy — including "security review on Opus, always" — is scoped to one of the three agents. A PR authored by the OpenAI agent or by Copilot has **no defined reviewer tier and no defined security reviewer at all**; the rule cannot even be violated, because it does not apply. Since the security review is the corpus's strongest control, this is a hole shaped like a whole toolchain. Team composition itself is consistent (`AGENTS.md:199`, `decision-log.md:488`, `adr/0008-single-design-system.md:65`, `risks.md:142`). | Re-title the section "Model tiers and review tiers" and state the rule agent-agnostically: *every PR, whichever agent wrote it, gets an architecture/QA review from a stronger context than the author's and a separate security review on Opus; when the authoring agent is not Claude Code, the Opus security pass is run by a Claude Code session against the diff.* Then the PR field `Security-reviewed-by:` is answerable for all three. |
| medium | `docs/01-architecture/security-model.md:419-438` | "### The evidence chain — A control in this document is an *intention* until its test runs green." | The table has fourteen rows; thirteen name a test file. Row 436 — **the Opus security review** — names "PR template, phase gate" instead, i.e. the one control whose evidence is a document that does not exist (see row 1). The row is also malformed: it carries three cells under a two-column header (`\| Planned control \| Evidence \|`, line 424), as do rows 437-438, so it renders wrong and reads as if a third column were defined. By the section's own standard, the security review is still an intention. | Give it a real artefact: `docs/07-planning/security-reviews/<pr-number>-<slug>.md`, committed in the PR, containing the surfaces examined, the model, and the findings with dispositions — then the evidence-chain cell can name a path like every other row, and `check:reviews` can assert the file exists when the diff touches a security surface. Fix the table to three columns while there. |
| medium | `AGENTS.md:186-187` / `docs/04-engineering/agent-workflow.md:228-229` / `docs/07-planning/status.md:331-343` | "updated at the end of every session. Read it before starting; update it before stopping." | **Prose only, and only for `status.md`.** No CI check ties `status.md` to anything: `check:inventory` compares the screen inventory with `lib/routes.ts` (`testing-strategy.md:299-300`) — a different pair of files, and ci-cd.md:45 describes it differently again ("screen counts match rows"). There is **no session-end rule for the decision log or `CHANGELOG.md`** anywhere: decision-log entries are required only situationally (`definition-of-done.md:16` for dependencies, `sdlc.md:179` "if a notable choice was made", `error-fix-loop.md:95`), and CHANGELOG prose is required only at phase close (`ci-cd.md:229-244`). For a rotating-agent team where "the repository is the memory" (`agent-workflow.md:226`), the memory write is the least protected step in the process. | Extend `check:inventory` (or add `check:status`) to fail the fast stage when a PR changes `docs/03-features/**`, `docs/07-planning/phases.md` or `apps/**` without touching `docs/07-planning/status.md`. Add a DoD "Any change" checkbox: "- [ ] `status.md` session log entry added — state, not intent". State explicitly in `agent-workflow.md#sessions-and-memory` that a decision-log entry is required for any dependency, convention or scope change, and reconcile the two `check:inventory` definitions. |
| low | `docs/04-engineering/error-fix-loop.md:99-116` vs `AGENTS.md:149` vs `docs/04-engineering/sdlc.md:157-160` vs `docs/04-engineering/agent-workflow.md:163-164,254` | "**After three failed attempts at the same problem, stop.**" | Consistent in count (three) and in intent across all four, so no contradiction — but the escalation target drifts: AGENTS.md:149 says "write down what you tried and **ask**", error-fix-loop.md:111 and sdlc.md:159 say "escalate to **Thomas**", agent-workflow.md:163 says "Ask when genuinely blocked". Enforcement is **prose only** in all four, and it is unenforceable by construction — nothing outside the agent's own context can count attempts. | Leave the rule; make the *output* checkable instead. Require the five-item write-up from `error-fix-loop.md:103-109` to be posted as a PR comment or appended to `status.md` under **Blocked** before the agent stops — an artefact Thomas can see, rather than a counter nobody holds. |
| low | `AGENTS.md:138-164` (fifteen do-nots) vs `docs/04-engineering/agent-workflow.md:166-179` (nine do-nots) | Two "Do not" lists of different lengths | agent-workflow.md's list omits six of AGENTS.md's: no-hardcoded-per-customer/env-var (rule 2), the vocabulary rule (do-not 11), pending-action deletion (12), no invented `mcp:*`/SCIM authority path (13), inherited kaneo integration routers (14), and the empty-review-section rule (15). It also adds two AGENTS.md lacks: "do not guess at behaviour" (177) and "do not claim something works without running it" (178). An agent told to "read this document first, then AGENTS.md" gets a different rule set depending on order. | Make agent-workflow.md's Do-not list a pointer: "The do-not list is in AGENTS.md (`../../AGENTS.md#do-not`). It is not restated here so the two cannot drift." Move "do not guess" and "do not claim it works without running it" into AGENTS.md as do-nots 16 and 17. |
| low | `docs/02-design/ux-quality-gates.md:149-177` (`P1`–`P6`) vs `docs/07-planning/phases.md` (`P0`–`P5+`) | "## Phase gate — P1 · Screen review … P6 · Real data" | **`P<n>` means two different things.** In ux-quality-gates.md it is a phase-gate check; everywhere else in the corpus (`phases.md`, `release-plan.md:68-71`, `agent-workflow.md:214-218` "ours, P0" / "ours, P2", `security-model.md:436-437` "the P3 identity gate") it is a delivery phase. "P2" is simultaneously "screen reader pass" and "the third phase". A memoryless agent handed "close P3" cannot tell which is meant. | Renumber the phase-gate checks `PG1`–`PG6` in `ux-quality-gates.md` and update the two references to them. Reserve bare `P<n>` for delivery phases. |
| low | `AGENTS.md:44-53` (rule 2), `AGENTS.md:150-152` (do-not 11), `AGENTS.md:144` (do-not 5) | "Environment variables are for bootstrap only — five required … and nowhere else" ; "Name a table, column, capability, feature flag, event key or job that is not in its single authoritative document" ; "Disable a test to make a build pass — **ever**" | **All three are prose only, and all three are mechanically checkable.** No CI step compares `process.env` reads against `configuration-reference.md`; no step compares table/capability/event/job identifiers against `data-model.md`, `rbac.md`, `events.md`, `background-jobs.md`; no step greps for `.skip(` / `.only(` / `describe.skip` (the only trace is a self-ticked box, `definition-of-done.md:15`). Do-not 5 is the *literal* v1 failure mode — a green build purchased by removing the check. | Three small scripts in the fast stage, cheap to write against an empty repo: `check:env` (every `process.env.X` read appears in `configuration-reference.md`), `check:vocab` (every Drizzle table/column, capability string, flag key, event key and job name appears in its authoritative doc), `check:no-skip` (no skipped/only tests in the diff, and the total test count never decreases without a line in the PR saying why). Add all three to `repository-bootstrap.md`'s P0 script list. |
| low | `AGENTS.md:158-160` (do-not 14) | "Keep, flag or 'leave for later' an inherited kaneo integration router … they are **deleted at fork**" | Backed by a plan (`docs/01-architecture/inherited-features.md:15-20`, `repository-bootstrap.md` P0 step 1) but by **no test**. `route-coverage.test.ts` would flag a surviving router only until someone gives it a policy entry, at which point it is green and shipped. Given the same file lists `public-project` — an *unauthenticated read surface* — as a deletion, "green but still present" is the dangerous state. | Add `tests/permissions/no-inherited-integration-routes.test.ts`: assert that no route path matches `/(public|github|gitea|slack|discord|telegram)/` in Hono's router, and that the packages `octokit`, `@octokit/webhooks` and the chat SDKs are absent from every `package.json`. Name it in `inherited-features.md` and in the evidence chain. |
| low | `docs/04-engineering/definition-of-done.md:3-4` | "Copy the relevant checklist into the pull request description and tick it. An unticked box is a blocker, not a note." | Self-attestation with no verification, and the instruction conflicts with having a PR template at all: if the author copies a checklist by hand, the template's fixed sections cannot be machine-checked, and an agent can copy a *shorter* list. Nothing detects a checklist that was never pasted. | Invert it: the PR template ships **all** checklists, with the irrelevant sections marked `n/a` rather than deleted; CI asserts the section headings are present and that no box is left unticked and unmarked. Then "unticked is a blocker" becomes true rather than aspirational. |

## The enforcement table

Every rule that governs agents, and what actually stops an agent from routing around it.
"Mechanism" = a CI step, a named test, branch protection, or a script. A checkbox an agent
ticks itself is **not** a mechanism; it is prose with a box.

### AGENTS.md — the five rules

| # | Rule | Mechanism | Verdict |
| --- | --- | --- | --- |
| 1 | UI/UX is kaneo's; no bespoke primitives (`AGENTS.md:37-42`) | `check:ui` — fails on any primitive outside `packages/ui`, any `@radix-ui/*`/`@base-ui/react` import outside it, any Radix primitive not in `KNOWN-RADIX.md` (`ci-cd.md:38-40`, `testing-strategy.md:296-298`) | **Enforced** |
| 2 | Nothing hardcoded per customer; env vars for bootstrap only (`AGENTS.md:44-53`) | None. No check compares `process.env` reads with `configuration-reference.md`; no check for `if (customer === …)` | **Prose only** |
| 3 | Every route declares its permission (`AGENTS.md:55-58`) | `route-coverage.test.ts` over **Hono's router**, not the OpenAPI doc (`testing-strategy.md:87-89`), + `matrix.test.ts` ×2 (capability and reach), + `test:permissions` in the fast stage (`ci-cd.md:50-53`), + ADR 0010 | **Enforced — the model the rest should copy** |
| 4 | Every screen has a URL (`AGENTS.md:60-63`) | Route-registry round-trip test (G5) + `check:inventory` (`ci-cd.md:45`, `testing-strategy.md:299-300` — but the two describe different comparisons) | **Enforced, definition ambiguous** |
| 5 | Ship narrow and finished (`AGENTS.md:65-67`) | None. "A phase completes before the next starts" rests on the phase gate, which has four non-agreeing lists and no mechanism | **Prose only** |

### AGENTS.md — the fifteen do-nots

| # | Do not | Mechanism | Verdict |
| --- | --- | --- | --- |
| 1 | Invent a UI primitive outside `packages/ui` | `check:ui` | Enforced |
| 2 | Literal colour or arbitrary spacing | `check:tokens` (G2, G3) | Enforced |
| 3 | Route without a policy | `route-coverage.test.ts` | Enforced |
| 4 | Add a dependency without asking | Self-ticked box (`definition-of-done.md:16`); no check that a lockfile diff is accompanied by a decision-log entry | **Prose only** |
| 5 | Disable a test to make a build pass — **ever** | Self-ticked box (`definition-of-done.md:15`); no `.skip`/`.only` grep, no test-count floor. *This is the literal v1 failure mode* | **Prose only** |
| 6 | Waive a quality gate — only Thomas | Procedure in `ux-quality-gates.md:195-204`; no mechanism, and `release-plan.md:101-105` already waives four gate activities with no decision-log entry (`decision-log.md:711` "None yet") | **Prose only, already breached** |
| 7 | Approve your own design review | Prose "absolute" (`agent-workflow.md:26-28`); H1–H6 answered in the PR body with no field naming who answered | **Prose only** |
| 8 | Refactor beyond the task | Prose (`coding-standards.md`'s one-logical-change rule, reviewer judgement) | **Prose only — acceptable; a diff-size heuristic would be worse than the rule** |
| 9 | Paste code from an unlicensed source | `THIRD-PARTY-NOTICES.md` convention; no scanner | **Prose only** |
| 10 | Keep trying after three failed attempts | Prose ×4, uncountable from outside the agent | **Prose only — enforce the write-up, not the count** |
| 11 | Name a table/column/capability/flag/event/job not in its authoritative document | None | **Prose only — and mechanically checkable** |
| 12 | Delete anything without a pending action | Named suite: `tests/api-integration/pending-actions/` + `tests/e2e/security/` (`testing-strategy.md:187-197`), `delete-returns-202-and-deletes-nothing.test.ts` in the evidence chain (`security-model.md:435`) | Enforced |
| 13 | Invent an `mcp:*` permission or an IdP path to `instance:admin` | `testing-strategy.md:163-166` ("no `mcp:*` capability exists in the capability enumeration"; schema `CHECK` asserted) + identity tests 09/11 | Enforced |
| 14 | Keep or flag an inherited kaneo integration router | Plan only (`inherited-features.md:15-20`, `repository-bootstrap.md` P0 step 1); no absence test | **Prose only** |
| 15 | Start building while the feature's review section is non-empty | Self-ticked box (`definition-of-done.md:80-83`) + prose "reviewers check this box, not the author" (`sdlc.md:61`) | **Prose only** |

### The rest

| Rule | Mechanism | Verdict |
| --- | --- | --- |
| Absolute 1 — an agent may never approve its own design review (`agent-workflow.md:26`) | Prose; `main` requires "one approval" (`ci-cd.md:207`) but no CODEOWNERS rule is specified | **Prose only** |
| Absolute 2 — an agent may never waive a quality gate (`agent-workflow.md:27`) | Prose; procedure exists, record is empty while a waiver is in force | **Prose only** |
| Model tier — Sonnet implements, Opus/Fable reviews (`agent-workflow.md:78-81`) | None. No field records which model did what | **Prose only** |
| Model tier — Opus security review at every PR **and** every phase gate (`agent-workflow.md:82-88`) | A CI non-empty check on a **PR-template section that does not exist**, scoped to three path globs narrower than the rule (`ci-cd.md:83-85`); five different scope statements across four documents | **Half-mechanism, pointing at a missing file** |
| Verify before you believe — open the screen (`AGENTS.md:128-131`) | None. No screenshot, no field, no box | **Prose only** |
| A spec's review section must be empty before build (do-not 15) | Self-ticked box | **Prose only** |
| Session end — update `status.md` (`AGENTS.md:186-187`) | None; `check:inventory` checks a different pair of files. No rule at all for the decision log or `CHANGELOG.md` at session end | **Prose only** |

**Which prose-only rules are the ones v1 died of?** Four, in order:

1. **"Verify before you believe" / open the screen** — v1's stated cause of four of its worst
   defects (`AGENTS.md:130-131`, `testing-strategy.md:3`). Enforced by nothing at all.
2. **"Do not disable a test to make a build pass"** — v1's green suite hid eleven
   authorization holes. Enforced by a box the agent ticks.
3. **The Opus security review** — the corpus's strongest declared control, terminating in a
   PR template that does not exist, with a CI trigger narrower than its own rule.
4. **"Ship narrow and finished" / the phase gate** — "v1 died of twenty-five screens at
   sixty per cent" (`AGENTS.md:67`) and "v1 died of 'later'" (`definition-of-done.md:146`).
   Four disagreeing phase-gate lists and a blanket consolidation already granted.

The pattern is exact: **every rule that closes a v1 code defect has a test; every rule that
closes a v1 process defect has a sentence.** The process rules are the ones agents route
around, because an agent's only cost for ignoring a sentence is that it must write a
different sentence.

## Top 5

1. **The PR template does not exist** (`ci-cd.md:83`, `security-model.md:436` both depend on
   it). Every model-tier, security-review and evidence rule in the corpus terminates in a
   file nobody has written and no document specifies. Write it, specify its fields in
   `definition-of-done.md`, and add it to `repository-bootstrap.md`'s P0 list — it is the
   single change that converts four other prose-only rules into checkable ones.
2. **The model-tier policy is unrecorded and therefore unenforceable** (`agent-workflow.md:70-97`).
   Nothing captures which model implemented, reviewed, or ran the security pass. Three
   required PR fields plus a CI regex is the whole fix — and without it, "Opus. Always. Not
   cost-negotiable" is a sentence an agent can satisfy by writing a different sentence.
3. **"Verify before you believe / open the screen" has no artefact** (`AGENTS.md:128-131`,
   `agent-workflow.md:200`, `error-fix-loop.md:69`). The corpus names this as the cause of
   four of v1's worst defects and enforces it with nothing. Require a `## Screens opened`
   section with route, viewport and a screenshot; fail CI if `apps/web/**` changed and it is
   empty.
4. **The security review has five different scopes across four documents** and the only
   mechanism — a CI path trigger (`ci-cd.md:84-85`) — is narrower than the rule it enforces,
   missing uploads, webhooks and new route files that `sdlc.md:119-120` explicitly names.
   Make ci-cd.md's globs authoritative, widen them, and have the other three cite rather
   than restate. Give the review a committed artefact so the evidence chain
   (`security-model.md:419-438`) has a path to name, like its other thirteen rows.
5. **Four disagreeing phase-gate lists, and one blanket waiver already granted with no
   record.** `sdlc.md:212-229`, `definition-of-done.md:120-135`, `ux-quality-gates.md:149-177`
   and the pointer chain `phases.md:26` → sdlc → `ux-quality-gates.md` do not contain the
   same items; meanwhile `release-plan.md:101-105` consolidates four gate activities out of
   every phase while `decision-log.md:711` says "*(None yet.)*" and `phases.md:20` forbids
   exactly that. Collapse to one list in `definition-of-done.md#phase-completion` and record
   the consolidation as a real waiver.

## Assessment of the four proposed additions

### P1 · Choose the kaneo SHA deliberately, and run kaneo's own suite on it first

**(a) Already covered — partly.** `repository-bootstrap.md:9` records the SHA
(`git -C ../kaneo rev-parse HEAD` → `THIRD-PARTY-NOTICES.md` and the inherited-features
register) and `:50-52` has it filled into the register. `:12-14` already requires the
supply-chain half: "`pnpm audit` in `../kaneo`, Trivy on `Dockerfile.kaneo`'s build; fix or
note every high/critical **before** the fork commit". So **Trivy-clean is already a rule**.
What is **not** covered anywhere: *why that SHA* (tag versus main), kaneo's own CI status at
that commit, and running kaneo's test suite before copying.

**(b) Conflicts.** No rule conflicts. But the naive form of this addition — "take the latest
release tag" — would be actively harmful here, and the addition should say so rather than
leave an agent to reason it out. `v2.22.0` is 54 commits and two weeks behind main, and
those commits include authorization fixes ("close five workspace-scoping gaps", "read the
raw body in task permission middleware"). Taking the tag imports known-fixed authorization
bugs into a project whose founding rule is `AGENTS.md:55-58` — "v1 shipped eleven
authorization holes past a green test suite" — and whose largest P0 task is a hand pass over
exactly those routers (`repository-bootstrap.md:62-66`). And because `AGENTS.md:12-14` says
kaneo is taken "**once**… There is no upstream relationship", the choice is permanent: there
is no later upgrade that picks the fixes up. The tag's only advantage — that a release was
cut against it — is worth less than five authorization fixes to a fork that will never
merge again.

The second half of the proposal is the stronger half and has an independent justification
already in the corpus: `repository-bootstrap.md:99` makes "`pnpm test:all` is green with
kaneo's inherited routes present" the P0 step-1 exit. Without a **pre-copy baseline**, a red
test after the fork cannot be attributed — kaneo's, or ours. That baseline is cheap now and
impossible to reconstruct later.

**(c) Where it lands.** `docs/04-engineering/repository-bootstrap.md`, section
**"## 0. Before copying anything"**, replacing item 1 and inserting a new item 2 (renumber
the existing 2 and 3). Nowhere else — this is a one-time procedure, not a standing rule, and
putting it in AGENTS.md would outlive its usefulness.

**(d) Suggested wording.**

> 1. **Choose the commit, and write down why.** Do **not** default to the latest release
>    tag. At the time of writing, kaneo's latest tag `v2.22.0` is 54 commits and about two
>    weeks behind `main`, and those commits include authorization fixes — "close five
>    workspace-scoping gaps" and "read the raw body in task permission middleware" among
>    them. Because kaneo is taken **once** and never merged again (`AGENTS.md`), a commit
>    chosen for tidiness carries its known-unfixed authorization bugs into TaskDesk
>    permanently, and the P0 router retrofit would be re-deriving fixes that already exist
>    upstream. **Default to `main`'s HEAD**, unless the diff since the last tag contains
>    something you can name as a risk.
>
>    Record in `THIRD-PARTY-NOTICES.md` and the inherited-features register, in this order:
>    the full 40-character SHA; whether it is a tag or a `main` commit and **which**; the
>    date; the status of kaneo's own CI on that commit; and one sentence saying why this
>    commit and not the last tag. "Latest" is not a reason.
>
> 2. **Run kaneo's own test suite on that exact SHA, before copying anything**, and record
>    the result — pass counts, failures, skips — beside the SHA. This is the baseline that
>    makes the P0 exit criterion ("`pnpm test:all` green with kaneo's inherited routes
>    present", § 7) attributable: after the fork, a red test is either one we broke or one
>    that was already red, and only this record can tell the difference. If kaneo's suite is
>    already red on that SHA, note each failure explicitly — do not fix it here, and do not
>    let it be discovered as "ours" three days later.

---

### P2 · A pilot-tenant rehearsal gate at internal go-live

**(a) Already covered — substantially, but scattered and untimed.**
`accelerated-delivery-plan.md:147-159` already defines the week-5 go-live gate as load test,
a full security pass, "a bug bash against the realistic and hostile seed datasets", and a
"**Backup and restore drill** — R12 in risks.md exists precisely because this step gets
skipped under deadline pressure; it does not get skipped here". `definition-of-done.md:130,
133` already require "Run against realistic data — 10,000 work items, 50 projects, 200
people" and "Backup and restore verified". `ux-quality-gates.md:164-167` (P4, fresh-eyes)
already requires an unfamiliar person to attempt the main task unaided with every hesitation
logged. `security-model.md:437` puts an internal red-team pass "**At the go-live gate**".
`ci-cd.md:274-286` already defines a post-deploy smoke test.

What is genuinely **new and worth adding**: running those first-week workflows **as one
continuous sitting, in order, on the clock**, including *configure Entra* and *invite a
customer* (an operator/administrator path no existing gate exercises end to end) and
*breach an SLA on purpose* (the product's most important logic, currently proven only by the
unit suite, `testing-strategy.md:47-49`). A timed demo path is also the only gate that
catches "each step works, the sequence is unusable".

**(b) Conflicts — yes, one, and it is fatal as worded.** "If the demo path… requires a
shell, it is not done" contradicts the deployment design in four places:
`deployment.md:42` — first run is "on any machine with **a shell** and outbound HTTPS";
`repository-bootstrap.md:94` and `configuration-reference.md:38` — the first-run setup page
is "unlocked by a token **printed in the container log**"; `deployment.md:151-168` — upgrades
are `scripts/deploy.sh` plus a mandatory pre-upgrade backup; `backup-and-restore.md` and
`runbook.md:150-151` — restore is an operator procedure by design. The gate as written fails
by construction, and a gate that always fails is either waived on day one (which
`AGENTS.md:145` says only Thomas may do) or quietly ignored — the worse outcome. Note also
`phases.md:212-213`'s existing bar, "a fresh container can be turned into a customer's own
service desk **without touching a file**", which is the right shape: it forbids *editing
config*, not *using a terminal*.

**(c) Where it lands.** `docs/04-engineering/definition-of-done.md`, as a new section
**"## Go-live rehearsal"** placed after "## Phase completion" — gates live in the DoD, and
the DoD outlives the calendar. Then one-line cross-references from
`accelerated-delivery-plan.md`'s week 5 list and `phases.md`, both of which should cite it
rather than restate it (see the phase-gate finding above).

**(d) Suggested wording.**

> ## Go-live rehearsal
>
> Before the first real tenant — internal or external — the whole first week of a customer's
> life is rehearsed **once, in order, in a single sitting, against the `realistic` seed**,
> and timed. Not each step proven separately: the sequence, start to finish.
>
> Two lanes, with different bars.
>
> **Administrator lane — browser only, ten minutes.** From a running instance, with no
> terminal and no file edited: create an organisation; configure Microsoft Entra for it;
> invite a customer and have them sign in; raise a request from the portal; triage it; let
> an SLA breach **on purpose** and confirm the breach is visible where the spec says it is;
> resolve it. Wall-clock over ten minutes, or any step that cannot be completed in the
> browser, **fails the gate** — that is `phases.md`'s "without touching a file" bar, made
> timed and specific.
>
> **Operator lane — a shell is expected; improvisation is not.** Install, restore from
> backup, and run an upgrade are shell procedures **by design**
> (deployment.md (`../05-operations/deployment.md`),
> backup-and-restore.md (`../05-operations/backup-and-restore.md`)), as is reading the
> one-time setup token from the container log. The bar here is not "no shell": it is that
> each is completed by **following the runbook exactly, in the documented commands, with no
> step the runbook does not name**, and timed. A step that needs a command the documentation
> does not contain is a documentation defect and fails the gate.
>
> Record both lanes' timings and every hesitation in the phase review note. A hesitation is a
> design bug (UX quality gates (`../02-design/ux-quality-gates.md`) P4), and a step that took
> three times its expected duration is one too.

---

### P3 · Never downgrade the reviewer tier when a usage limit hits

**(a) Already covered — no. And the failure mode has already happened, twice.**
Nothing in the corpus says what to do when a session runs out of capacity mid-review. The
nearest text is `agent-workflow.md:82` — "Opus. Always. Not optional, **not
cost-negotiable**" — which addresses *budget*, not *availability*, and an agent that cannot
reach Opus will read "cost" as not covering its situation. Meanwhile `status.md:6`, `:59-60`
and `:286` record that "the OpenAI agent and GitHub Copilot both hit usage limits
mid-session" and the work was handed on. So this is a documented, recurring, real event with
no rule attached — the strongest possible case for adding one.

**(b) Conflicts — none.** It reinforces `agent-workflow.md:26-28` (the two absolutes) and
`:95-97` ("A stronger model reviewing is a stronger check, not a different kind of
permission"). One gap to close in the wording: a bare "WAIT" is a rule with no exit, and an
agent under the accelerated calendar will treat an open-ended wait as pressure to find a
reading of it that permits proceeding. Name what the agent does *while* waiting — which the
corpus already has a slot for: `status.md:339` "Record anything **Blocked**, with who
unblocks it".

**(c) Where it lands.** `docs/04-engineering/agent-workflow.md`, in
**"## Model tiers within Claude Code"**, immediately after the paragraph at lines 95-97 that
restates the two absolutes — so it reads as the third one and inherits their weight. Not in
AGENTS.md's do-not list: it needs the surrounding tier context to be intelligible.

**(d) Suggested wording.**

> **A third absolute: an unavailable reviewer is not a downgraded reviewer.**
>
> When a usage limit, a quota, an outage or a timeout makes the required tier unreachable
> mid-review — **stop and wait**. Do not continue on a lower tier. Do not let the authoring
> session review its own work "just this once", and do not let a Sonnet implementation
> subagent review the code it wrote, under any framing: not "a quick sanity pass", not "just
> the diff", not "pending the real review". A review recorded at the wrong tier is worse than
> no review, because it closes the PR field that would otherwise stay visibly open.
>
> While blocked: push the branch, write what is finished and what is unreviewed in the pull
> request description, add a **Blocked** entry to
> status.md (`../07-planning/status.md`) naming the tier you are waiting for and who
> unblocks it, and stop. Waiting for capacity is a normal, recordable state — the same
> class as "three attempts failed" (error fix loop (`error-fix-loop.md`)), and handled the
> same way. Only Thomas may decide the work proceeds without the review, and that decision
> is a gate waiver: it follows the waiver procedure in
> UX quality gates (`../02-design/ux-quality-gates.md#waiving-a-gate`), including the
> decision-log entry.

---

### P4 · AGENTS.md Do-not 16 — no commit, push or merge without explicit approval

**(a) Already covered — the merge half, yes; the commit/push half, not at all.**
`agent-workflow.md:23` — "Merges to `main` \| Thomas ✅ \| Agents ❌"; `:24` the same for
production deploys; `ci-cd.md:199, 207` — "`main` always deployable, protected" and "`main`
requires: all checks green, one approval, up to date with `main`". Nothing anywhere
addresses committing or pushing to a feature branch, and the corpus contains a precedent of
an agent doing exactly that: `status.md:278` records "first commit and push to
`docs/v2-planning-corpus`".

**(b) Conflicts — yes, plainly, and it should be said plainly.** P4 as worded reverses
Thomas's own recorded standing instruction — *report first, then commit, push, update the
PR; he reviews the PR afterwards*. It also fights two rules already in the corpus. First,
requiring per-session approval for every commit pushes agents toward one large end-of-session
commit, which `coding-standards.md:213-214` and `agent-workflow.md:173-174` both forbid:
"a pull request that fixes a bug *and* refactors four files is unreviewable, and
unreviewable pull requests get approved without being read". Second,
`agent-workflow.md:230` says "Long-running context goes in the **pull request description**,
not in the conversation" — an agent that may not push cannot open the PR that is supposed to
hold the context, which for a memoryless team is the thing being protected.

There is also an opportunity cost. The real, unenforced gap is not commit/push — it is that
"only Thomas merges to `main`" is **prose with no mechanism** (see the absolutes finding
above: `ci-cd.md:207`'s "one approval" does not name whose). P4 spends the rule budget on the
half that is cheap and reversible, and leaves the half that is expensive and irreversible as
a sentence.

**Recommendation: adopt the split version, not the strict one.** Branch pushes stay cheap
(they are reversible, they are how a PR gets a body, and they are how Thomas reviews at all);
merge and `main` become mechanically untouchable, which is what the strict version was
reaching for.

**(c) Where it lands.** Two places, not one. The do-not goes in `AGENTS.md`'s **"## Do not"**
list as item 16. The mechanism goes in `ci-cd.md`'s **"## Branching"** section, extending the
`main` requirements at line 207 — a do-not without the CODEOWNERS rule beside it is another
prose-only rule, which is the pattern this whole review is about.

**(d) Suggested wording.**

> `AGENTS.md`, Do not, item 16:
>
> 16. Merge a pull request, push to `main`, force-push or rewrite history on any shared
>     branch, or tag a release. Only Thomas does these, and `main` enforces it.
>     Committing and pushing to your **own feature branch** is expected, not restricted —
>     report what you did first, then commit, push and update the pull request description
>     so Thomas reviews the PR rather than a summary of it. Small, conventional commits;
>     never one end-of-session commit that hides the shape of the work. **A report is not
>     approval for anything on this list**, and neither is a green pipeline.

> `ci-cd.md`, § Branching, replacing "one approval":
>
> - `main` requires: all checks green, **one approving review from the CODEOWNERS entry —
>   Thomas's account, and no other** — up to date with `main`, conversations resolved, and
>   **no bypass actors, including administrators**. Force-push and branch deletion are
>   disabled. This is what makes "only Thomas merges to `main`"
>   (agent-workflow.md (`agent-workflow.md#roles`)) a mechanism rather than a sentence.

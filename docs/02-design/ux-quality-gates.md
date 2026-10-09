# UX quality gates

> v1 was feature-rich and unusable. These gates exist so that cannot happen again.
> They are mostly automated, because a person under deadline is not a reliable gate and
> v1 had reviewers too.

A pull request that fails any gate does not merge. There is no "we'll fix the UX later"
— that sentence is the exact mechanism by which v1 died.

---

## Automated — runs on every pull request

### G1 · No bespoke primitives

Three checks wearing one number — they need three implementations, so they are named apart:

- **G1a — raw elements.** Fails on a raw `<button>`, `<input>`, `<select>`, `<textarea>` or
  `<dialog>` outside `packages/ui`. kaneo lints with **Biome**, which has no equivalent of
  ESLint's `react/forbid-elements`, so this is a small AST script (`check:ui --raw-elements`)
  over JSX in `apps/web`, not a lint rule.
- **G1b — import boundary.** Fails on any import of `@radix-ui/*`, the `radix-ui` umbrella
  package or `@base-ui/react` outside `packages/ui`, and inside `packages/ui` on any Radix
  import not listed in `packages/ui/KNOWN-RADIX.md` ([ui-extraction-plan.md](ui-extraction-plan.md)).
  This is `check:ui` proper.
- **G1c — the old directory stays empty.** `scripts/ci/check-ui.mjs` fails if
  `apps/web/src/components/ui` contains any entry after extraction, including ignored and
  untracked files. App-specific compositions live under `apps/web/src/components/`; shared
  primitives live under `packages/ui`. The five former app files are not exceptions: the
  API-aware avatar adapter is `apps/web/src/components/avatar/`, error display/fallback are
  `apps/web/src/components/errors/`, the session-loading shell is
  `apps/web/src/components/app-shell/`, and the error-test harness is the route-local
  `/test-error` module. The route and imported composition remain functional at those
  locations. This is the selected disposition for #403's five-file residue; it does not
  approve app-owned primitives inside `packages/ui` or a non-empty legacy directory.

**Why:** v1 hand-wrote every primitive and got inconsistency, missing icons and ad-hoc
accessibility. See [ADR 0008](../01-architecture/adr/0008-single-design-system.md).

**Escape hatch:** an inline `// ui-exempt: <reason>` comment. Reviewed; rarely justified.


### G2 · Tokens and density slots

**Scope:** G2 enforces semantic color/token use and the registered density slots. It is not a
repository-wide ban on Tailwind's arbitrary-value syntax, radius or z-index utilities. The
existing design decision uses Tailwind's built-in spacing, type, shadow and z-index scales
directly; only repeated rows, shared form fields and `CardPanel` have a density contract.
This bounded scope is intentional and does not claim arbitrary spacing elsewhere has been
normalized.

**Fails on:** a hard-coded colour outside `packages/ui/src/styles/`, and on fixed vertical
padding/gap utilities placed directly on a registered density slot. The shared classes
`td-density-row`, `td-density-field`, and `td-density-card` are the only density controls.
Comfortable is the default; the existing root `compact-mode` preference applies the compact
values. The currently checked slots are shared table rows, input controls, and `CardPanel` in
`packages/ui`; they use the classes from `packages/ui/src/styles/density.css`. Ordinary
layout spacing outside those named slots continues to use Tailwind's built-in scale.

`scripts/ci/check-tokens.mjs` checks registered rows, fields, and `CardPanel` density markup,
rejects direct fixed padding/gap utilities there, and uses positive/negative probes. It does
not claim to enforce arbitrary spacing, radius, or z-index utilities elsewhere. `design-tokens.md`
owns the class values and the slot inventory.

### G3 · Contrast

**Fails on:** any declared, actually used foreground/background pair below WCAG AA in either
theme, any used pair missing from the manifest, a stale manifest entry with no observed
source use, or a used foreground occurrence whose painted surface is not proven. The source
inventory covers every shipped TSX/JSX product component and Storybook story under
`apps/web/src` and `packages/ui/src`; unit-test and spec renderers are excluded because they
do not establish shipped surface contexts. It follows actual component/caller surfaces,
including aliases, nested render helpers, state branches and translucent ancestors. Each
repeated occurrence is bound independently before equivalent numeric pairs are deduplicated.
No Button/Badge/Input-only limitation remains.
`packages/ui/src/styles/pairs.json` records token roles, category/threshold, theme coverage,
usage owner, actual background class by theme, and effective opaque backdrop. The checker
scans styled TSX/JSX sources under `packages/ui/src` and `apps/web/src`, so an unlisted used
pair fails the gate. `pnpm check:tokens` runs the token/density checks and builds the web stylesheet, then loads that
stylesheet in Chromium, reads computed colours, composites transparent layers over the
declared effective backdrop, and checks 4.5:1 body text or 3:1 large text/non-text
indicators in light and dark themes. It activates hover and pressed attributes on the probe;
for autofill, it rewrites only the built `:has(:autofill)` state selector to an equivalent
probe attribute because headless Chromium cannot synthesize autofill. The production class
selector, declaration, variable values, and cascade remain from the built stylesheet.
Coverage and failure probes exercise unknown pairs, stale declarations, threshold failures,
and translucent surfaces. `design-tokens.md` owns the schema and
`packages/ui/src/styles/theme.css` is the value source. This numerical gate does not approve
provisional authored colors visually; H1–H6 design review is deferred to P4 under the
current user decision.

### G4 · Accessibility

**Fails on:** any critical or serious axe violation, on any screen exercised by the E2E
suite, and on any Storybook story.

### G5 · Every screen has a URL

**Fails on:** a route present in either generated tree (`routeTree.agent.gen.ts`,
`routeTree.portal.gen.ts`) but missing from `generatedRouteMetadata`, re-exported by
`lib/routes.ts` and generated from those trees, or a generated route template that fails
the build/parse round-trip test. `check:inventory` compares canonical URLs for inventory
routes marked in progress or complete with the generated trees. Not-started inventory URLs
remain planned; the checker reports their count without treating them as working routes.
Generated inherited and documented legacy routes stay in the registry and round-trip tests,
but do not become TaskDesk v2 inventory screens. This active-prerequisite scope follows the
[2026-09-28 applicable-now gate decision](../07-planning/decision-log.md#2026-09-28--10s-gate-scope-semantics-decided-applicable-now-gates-required-future-stage-gates-activate-with-their-prerequisite)
and the [G8 route-activation decision](../07-planning/decision-log.md#2026-10-01--g8-requires-implemented-screens-now-and-activates-future-routes-with-implementation).

**Also fails on:** for every implemented list surface (a `route`-kind screen marked in
progress or complete with filters, a layout
switch or a saved-view lens — the `Work`, `Backlog`, `Triage`, `Views` and `My work`
inventory rows), an E2E assertion that applying a filter changes the URL to encode it, and
that reloading that exact URL restores the same filter and layout state. Route registration
is necessary but not sufficient: `RP-8` ("the full filter state is in the URL") and `SV-19`
("every view has a URL that fully encodes it") are the substance principle 4 is about, and
only a round-trip test on view state — not merely on route existence — checks them.

**Why:** v1 had screens reachable only by clicking through a sidebar, and nested report
tabs with no address, so a manager could not link a colleague to what they were both
discussing.

### G6 · Every screen has four states

**Fails on:** a route component with no empty, loading, error or **partial** state
exercised in tests — matching all four states [design-principles.md](design-principles.md)
principle 7 requires, not three.

The automated check is structural and deliberately narrow: every route module registers
its `Empty`, `Loading`, `Error` and `Partial` state components (an AST check), and the E2E
fixture drives all four conditions for every route and asserts the registered component
rendered. Partial is mocked as a batch/list response where some records resolve and others
error (or, for a single-resource route, as a response with some fields present and others
flagged unavailable) — the route renders what it has and marks what is missing, per
principle 7, rather than falling back to the Error state on a partial failure. Whether a
state is *good* — not a bare "No results", not an unstyled error — is **H4**, a human gate;
this gate does not claim it.

### G7 · Storybook coverage

**Fails on:** an exported `packages/ui` component with no story.

### G8 · Visual regression

**Fails on:** an unapproved pixel change to any Storybook story or to any key screen
snapshot.

**Key screens required today** are the `route`-kind rows marked in progress or complete in
the [screen inventory](screen-inventory.md), plus every exported Storybook story. When a
route moves into progress, its route registration, deterministic browser fixture, and G8
baseline are required in that same change. Rows still marked not started remain planned
work; they do not need a route or baseline before implementation begins. As implementation
advances, every inventory route becomes a required key screen in the same change that moves
it into progress.

Approving a diff is an explicit action in the pull request, which puts intentional visual
change in front of a reviewer and catches unintentional change immediately rather than
three weeks later.

**Tool: Playwright `toHaveScreenshot`, with in-repo baselines** (Thomas, 2026-09-23 — see
[decision log](../07-planning/decision-log.md)). Baselines live alongside the Storybook
stories and key-screen tests they cover, committed to the repository (not an external
service) — `packages/ui/src/**/*.stories.tsx`'s baselines beside each story, key-screen
baselines beside the E2E spec that exercises them — so a diff is reviewable in the same
pull request that changed the pixels, with no separate account or service dependency.
"Chromatic-style" in older text meant only the approval workflow, never the Chromatic
dependency itself.

### G9 · Reduced motion

**Fails on:** the E2E suite failing when run with `reducedMotion: 'reduce'`.

### G10 · Keyboard reachability

**Fails on:** a core journey that cannot be completed keyboard-only.

Core journeys: sign in · create a work item · change its state · assign it · comment ·
raise a portal request · decide an approval · open the command palette and navigate.

### G11 · Performance budgets

Measured against a seeded dataset in CI.

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s |
| Interaction latency (a synthetic INP proxy, Playwright-measured on the named journeys) | < 200 ms |
| CLS | < 0.1 |
| Board render, 200 items | < 500 ms |
| List render, 500 rows | < 500 ms |
| Route transition | < 300 ms |
| Agent bundle, initial | < 350 KB gzip |
| Portal bundle, initial | < 200 KB gzip |
| Board drag, a scripted 2 s drag | p95 frame time < 20 ms, median of three runs |

A budget regression fails the build. Raising a budget requires a decision log entry. Bundle
sizes use Node's built-in gzip measurement over each Vite manifest entry's static JavaScript
imports and CSS. For the direct `Work — list` URL, the early-preloaded route component and its
static imports are also counted as the initial route graph; its preload hint is conditional on
`/agent/projects/{key}/work`, and uses the hashed assets resolved from the build bundle. Other
dynamic imports remain excluded, except that this graph includes the largest supported locale
chunk because the route hint preloads the browser-resolved locale. Until the agent/portal build
split exists, the single app entry and the direct work-list graph are both measured against the
agent's 350 KB budget. The
portal entry is measured against its 200 KB budget as soon as the split emits it. Field INP
is observed in production ([observability.md](../01-architecture/observability.md)), not
gated in CI — a shared runner cannot measure it.

The synthetic interaction proxy is required for every `G10` core journey whose owning
screen is implemented (screen-inventory status `in progress` or `complete`). The journey
list is the authority; a test may not silently omit an implemented journey. Per the
2026-09-28 decision-log entry on capability activation, a journey whose screen is not yet
implemented is not mocked or counted as passed; its test becomes required in the PR or
workstream that introduces that screen. G11 is not claimed complete while a named G10
journey lacks either an implemented measurement or an explicit not-yet-implemented
dependency.

For the keyboard Projects journey, the Playwright driver reads the existing in-page
`paletteNavigationPaint` mark immediately after pressing Enter, before its destination URL,
full-content and screenshot checks. Those functional checks still run unchanged afterward and
remain required; only their ordering relative to the Node-side mark read is specified here.
The in-page Enter start, visible pending-route predicate, and two-frame end mark do not move.

**Enabled measurement harness, per metric:**

| Metric | Tool | Throttling | Target route | Sample / flake policy |
| --- | --- | --- | --- | --- |
| LCP, CLS, route transition | Playwright, `PerformanceObserver` marks read via CDP | Network: Lighthouse's "Fast 4G" profile (1.6 Mbps down / 750 Kbps up / 150 ms RTT) via `Network.emulateNetworkConditions`; CPU: 4× slowdown via `Emulation.setCPUThrottlingRate` | `Work — list` (seeded, P1's canonical list surface) → first visible detail loading skeleton or detail content after the row click; the harness separately waits for actual detail data | Median of three runs; one automatic re-run on a failing sample before the build fails, per metric |
| Interaction latency (INP proxy) | Playwright, timestamped click-to-paint on the named core journeys (`G10`'s list) | Same profile as above | The journey's own screen; create measures the visible submitting state after the submit click, then separately waits for the created row | Median of three runs, same re-run policy |
| Board render (200 items) | Playwright, time from document start until the last seeded card is painted | Unthrottled — measures the app's own render cost, not the network | Current legacy project board (`/dashboard/workspace/{workspaceId}/project/{projectId}/board`) until P1's canonical board exists | Median of three runs |
| List render (500 rows) | Playwright, time from document start until all 500 seeded rows are painted | Unthrottled | `Work — list` (`/agent/projects/{key}/work?layout=list`) | Median of three runs |
| Board drag (p95 frame time) | Already specified above — a scripted 2 s drag, median of three runs | Unthrottled | `Work — board` | As stated in the table row |
| Agent / portal bundle size | `pnpm check:bundle-size`, Node gzip over the Vite manifest's static-import graph and CSS | n/a | n/a | Single measurement; a regression fails immediately, no re-run (deterministic) |

G11's timed samples retain failure traces with actions, screencast, source, and attachment data, while automatic DOM snapshots are disabled. Because Playwright 1.63 then leaves trace network files empty, each benchmark context separately attaches a bounded, sanitized network summary containing only the method, a closed known-safe benchmark route template (or the fixed label `unrecognized`), resource type, finite status, available finite timing, and an optional failure flag. Dynamic path values are always replaced by fixed placeholders, independent of their contents; unknown path shapes retain no path detail. It retains no raw request or response objects, headers, cookies, bodies, full URLs, or query strings, and reports truncation. Explicit screenshots taken after measured actions and all functional assertions remain required.

CPU/network throttling applies only to the metrics a real user's device and connection
would affect (LCP, INP, CLS, route transition); render-time and bundle-size rows measure
the application's own work and are deliberately left unthrottled so a regression there is
never masked by throttling noise.

**Speed-calibrated judgment (owner decision 2026-10-10).** `Emulation.setCPUThrottlingRate` is
relative to the host, so a slower hosted runner stays slower after throttling. To measure the
product rather than the runner, each sample set of a CPU-bound metric is preceded by a pinned
reference workload, and the metric is judged against its unchanged budget after normalisation
to reference speed. Only the measurement method changes; budgets, workloads, row/card counts,
throttling, network emulation, the three-sample median, and the single retry set do not.

- **Workload.** A deterministic, CPU-bound, React-like build in the same browser: a seeded
  virtual tree of 400 rows × 6 cells is mounted into the DOM, laid out, patched (text, class,
  and style changes), laid out again, and removed. It runs in a fresh context of the benchmark
  browser, with the metric's own CPU-throttle state (4× for throttled metrics, none for
  unthrottled ones). Two warm-up runs are discarded, five runs are measured, the statistic is
  the median, and the spread is (max − min) / median. Its source is
  `CALIBRATION_SOURCE` in `scripts/ci/lib/performance-calibration.mjs`, pinned by a SHA-256 that the
  bench checks before every run.
- **Factor.** `F = calibration median / R0`, with one R0 per throttle state, recorded against the
  pinned source hash and citing its hosted-run evidence. `F > 1` is a slower runner.
- **Normalisation, only where CPU-bound.** Unthrottled list render and board render, and the
  throttled interaction click-to-paint metrics (create, command palette open, command-palette
  keyboard navigation, task state, task assignment) and route transition: `value / F`. LCP: only
  the CPU portion after DOMContentLoaded is scaled, `DCL + (LCP − DCL) / F`; the network floor is
  never scaled (diagnosis data: DCL is about 2.05–2.16 s on both runner classes while the
  post-DCL portion is about 250–280 ms fast and 400–430 ms slow). Sign-in click-to-paint,
  comment click-to-paint, board-drag p95 frame time, CLS and the G13 windows are not CPU-bound
  on the recorded data (ratios 1.0, 0.84, 1.00 between runner classes; frame-quantised or
  dimensionless) and are judged raw.
- **Symmetric and fail-closed.** A runner faster than the reference makes normalised values
  larger, so it is judged more strictly. `F` must lie in [0.5, 2.5] and the calibration spread
  must be at most 0.35; otherwise the job fails, never passes. A present but malformed or stale
  R0 (non-positive value, a different source hash, or no cited evidence) also fails.
- **R0 required; calibration-only until recorded.** While R0 is absent the gate runs
  calibration-only: calibration is measured and logged but never gated, and every metric is
  judged raw, exactly as before this method. No calibrated gate is claimed until R0 is recorded
  from real hosted runs and pinned.
- **Logging.** The job prints the CPU model and `nproc`, whether R0 is pinned, and per sample
  set the calibration runs, median, spread, and factor, and the raw and normalised samples with
  both medians. When a retry occurs both sets are printed. Every metric is printed raw and
  normalised.
- **Retry rule unchanged.** The judged (normalised) median of three is compared with the
  budget; if it is at or over budget, one more set is calibrated and sampled, and that second
  set decides. Best-of-N is never used.

Historical G11 results measured before this method (including #602's attempt-1 FAIL, rerun
PASS, and run `37967068981` FAIL at `66c736e7`) remain as measured under the old method.

### G12 · Portal bundle purity

**Fails on:** any module under `routes/agent/` or `components/god-mode/` appearing in the
portal bundle's module graph (walked from the bundler's own metadata).

Achievable only with **two router trees**: two `tanstackRouter()` plugin instances
(`routes/agent`, `routes/portal`) generating two route trees, two Rollup inputs
(`src/main.tsx`, `src/main.portal.tsx`) and two HTML roots. kaneo's single generated
`routeTree.gen.ts` (49 static route imports) cannot satisfy this; the split is P0 work
([ui-extraction-plan.md](ui-extraction-plan.md)).

### G13 · No layout shift on data arrival

**Fails on:** layout shift above 0.1 measured **between the skeleton-mounted and
content-mounted performance marks** — a `PerformanceObserver` for `layout-shift` scoped to
that window — for every route the E2E fixture loads. This is the windowed complement of
G11's page-level CLS row, not a duplicate of it.

Skeletons must match the shape of what replaces them. This is the difference between an
interface that feels solid and one that jumps.

### G14 · Terminology overlay

**Fails on:** any screen whose visual-regression snapshot changes under a worst-case
terminology-override fixture (a very long override string, and a plural form that looks
nothing like the singular — [i18n.md](../01-architecture/i18n.md), `GM-T4`), or whose
accessible name no longer matches its visible label under that same override
([accessibility.md](accessibility.md), [i18n.md](../01-architecture/i18n.md)).

`G8`'s tool and in-repo baselines run a second pass with every `term:*` key resolved to the
fixture instead of its shipped string, over the same key-screen set `G8` covers. A snapshot
diff, or an axe/accessible-name check failing, fails the build. This is the CI form of the
"exhaustively tested" claim [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md)
makes for the terminology overlay — previously an ADR promise with no gate behind it.

---

## Human — at pull request review

For P0–P3, human H1–H6 review is deferred until the integrated P4 review; it is not an
early implementation or pull-request prerequisite. Record the status as deferred, never as
approved. The questions below remain the review criteria when that integrated human review
occurs. Automated accessibility, behavioral, and browser checks continue on the normal
implementation schedule.

### H1 · Does it look like kaneo?

The comparison has an artefact: a **kaneo reference screenshot set** captured at P0 (the same
snapshot step that copies the code) and committed under `tests/visual/kaneo-reference/`, and
a written vocabulary — kaneo's `skills/` (`pick-ui-library`, `animation-vocabulary`,
`review-animations`, `apple-design`, `emil-design-eng`), linked from
[design-principles.md](design-principles.md). "Does it look like kaneo" is a comparison, not
a memory test.


Open kaneo. Open this. Would they sit next to each other without one looking wrong?

This is the primary question for the integrated human review at P4.

### H2 · Progressive disclosure

Is everything on this screen needed *every time* someone opens it? If not, why is it not
behind a disclosure?

Particular scrutiny on the work item detail view, which is where fields accumulate.

### H3 · Microcopy

Read every string aloud. Does a person say that? Sentence case, no exclamation marks, no
"Oops", no blaming the user, no jargon leaking into the portal.

### H4 · Loading, empty, error

Not "do they exist" — G6 checks that — but "are they *good*?" Does the empty state
explain and offer an action? Does the error say what to do?

### H5 · Density preference

Does it honour comfortable versus compact, or did someone hard-code padding?

### H6 · Mobile

Does it work at **320 px** — matching [accessibility.md](accessibility.md)'s WCAG 1.4.10
commitment, not the 375 px this gate previously stated. An automated Playwright project
(`--project=mobile-320`, [ci-cd.md](../04-engineering/ci-cd.md)) already asserts the
portal's core journeys at this width in the full CI stage; `H6` is the human sanity check
alongside it, for surfaces and judgment calls the automated project does not cover. The
agent workspace need not be beautiful on a phone, but it must be usable. The portal must be
genuinely good on a phone, because that is where customers will use it.

---

## Stage gate — before a stage is declared complete

**The canonical stage-gate list is
[definition-of-done.md § Stage completion](../04-engineering/definition-of-done.md#stage-completion).**
The six checks below are its UX half, numbered `PG1`–`PG6` (renamed 2026-09-06) so they are
never confused with the delivery stages P0–P7.

### PG1 · Screen review

Every new screen walked through against [design principles](design-principles.md), with
a written sign-off in the stage review note.

### PG2 · Screen reader pass

VoiceOver on Safari and NVDA on Firefox, over the stage's core journeys.

### PG3 · Keyboard-only day

One working session using the product without touching the mouse. Findings logged.

### PG4 · Fresh-eyes test

Someone who has not seen the feature attempts its main task with no instruction. Every
hesitation is recorded. Hesitation is a design bug, not a user error.

### PG5 · Cross-browser

Chrome, Firefox, Safari, Edge. Latest and latest-minus-one.

### PG6 · Real data

Run against a seeded dataset with realistic volumes — 10,000 work items, 50 projects,
200 people, long titles, non-Latin names, empty fields. Most layouts break on real data,
not on demo data.

---

## What is deliberately *not* a gate

To be explicit, because v1 also over-constrained in the wrong places:

- **No cap on sidebar entries.** kaneo's shell handles a long navigation well; feature
  flags remove what a deployment does not use; the command palette makes depth
  survivable. An arbitrary number would force bad grouping.
- **No cap on fields in a form.** The gate is progressive disclosure, not a count.
- **No prescribed page layouts.** Match kaneo, use the primitives, pass the gates.

The gates constrain *quality*, not *shape*.

---

## Waiving a gate

Sometimes justified — a spike, a proof of concept, a genuine tooling false positive.

1. Say which gate, and why, in the pull request description.
2. Get explicit approval from Thomas. An AI agent may not self-approve a waiver.
3. Open a follow-up issue and link it.
4. Record it in the [decision log](../07-planning/decision-log.md), as an entry whose
   body carries the waiver **declaration** on one line:

   ```
   **Waives gate:** `G1` · **PR:** #19 · **Follow-up:** #123
   ```

5. Put that entry's `#anchor` in the pull request's `## Gates` link cell.

A waiver without a follow-up issue is not a waiver, it is debt with no owner.

**What is actually checked, and what is not.** The fast-stage PR-template check
([ci-cd.md](../04-engineering/ci-cd.md)) reads the **declaration line** inside the cited
decision-log entry. Nothing else. Stated precisely, because an earlier version of this
paragraph claimed four steps were mechanical when two and a half are:

| Step | Mechanically checked? |
| --- | --- |
| 1 — say which gate, and why, in the description | **The gate, yes** — the declaration must name the gate whose row is marked `waived`. **The "why", no.** No check reads the pull-request description for a justification, and none could judge one. |
| 2 — explicit approval from Thomas | **No, and not claimable.** Agents commit through the same repository identity Thomas does, so nothing readable from a committed file proves who wrote a line. |
| 3 — open a follow-up issue and link it | **Partly.** The declaration must carry a follow-up issue *number*. Whether that issue exists, is open, or is about this gate is **not** verified — that would need a GitHub API call, and buying a stronger-sounding claim with network dependence in a fast gate is a bad trade. |
| 4 — record it in the decision log | **Yes.** The cited entry must exist in the committed document, and the declaration must be one whole line inside it. |
| 5 — put the `#anchor` in the `## Gates` link cell | **Yes.** The anchor is mandatory and must resolve to **exactly one** entry. |

Prose is not accepted for any of it — the check that read prose accepted the sentence
*"G1 is not waived"* as authorisation for waiving G1.

So the declaration makes a waiver **durable, specific and attributable to a gate, a pull
request and a named follow-up number**. It does not make it *authorised*: that is Thomas's
to confirm, and no amount of parsing changes it.

## Related

- [Design principles](design-principles.md) · [Accessibility](accessibility.md)
- [Definition of Done](../04-engineering/definition-of-done.md)
- [Testing strategy](../04-engineering/testing-strategy.md)
- [Internationalisation](../01-architecture/i18n.md) — the layer `G14` and ADR 0012 build on

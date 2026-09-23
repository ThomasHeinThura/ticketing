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
- **G1c — the old directory stays empty.** Fails if anything lands in
  `apps/web/src/components/ui` after extraction.

**Why:** v1 hand-wrote every primitive and got inconsistency, missing icons and ad-hoc
accessibility. See [ADR 0008](../01-architecture/adr/0008-single-design-system.md).

**Escape hatch:** an inline `// ui-exempt: <reason>` comment. Reviewed; rarely justified.


### G2 · Tokens only

**Fails on:** a hex colour, `rgb()`, `hsl()`, `oklch()`, or an arbitrary Tailwind value
for colour, spacing, radius or z-index, outside `packages/ui/src/styles/`.

Run by `scripts/check-tokens.mjs`, inherited from v1 — one of the few things it got right.

**Known gap, not yet closeable:** this does not catch a hard-coded density utility (`py-3`
on a table row) that defeats the comfortable/compact preference — only an *arbitrary*
value (`p-[13px]`) fails today. [design-tokens.md](design-tokens.md#spacing-z-index-type-scale-shadow-layout--deleted)
states why: TaskDesk deliberately deleted its own `--space-*` token layer and left the
density mechanism itself (a semantic spacing token set, or a density utility class) as an
open follow-up, "recorded here once decided" rather than guessed at now. `G2` gains this
check once that mechanism is chosen; until then `H5`, a human gate, is the only backstop —
which is the gap this finding is naming, not a defect in this gate's own logic.

### G3 · Contrast

**Fails on:** any declared foreground/background pair below WCAG AA, in either theme.

The declared pairs and the token values this checks are real inputs, not a hypothetical:
[design-tokens.md](design-tokens.md)'s "Semantic assignments", "Status colours" and
"Priority and SLA colour tokens" sections give every token a value in both themes, and its
["Contrast (G3)"](design-tokens.md#contrast-g3) section defines the `pairs.json` schema —
one entry per declared foreground/background combination, `minRatio` 4.5 for body text and
3 for large text and non-text indicators. `check-tokens.mjs` composites translucent tokens
over their effective backdrop before measuring, per that section.

### G4 · Accessibility

**Fails on:** any critical or serious axe violation, on any screen exercised by the E2E
suite, and on any Storybook story.

### G5 · Every screen has a URL

**Fails on:** a route present in the generated route trees (`routeTree.agent.gen.ts`,
`routeTree.portal.gen.ts`) but missing from `lib/routes.ts` — which is **generated from
those trees, never hand-maintained** — or a declared route that fails the build/parse
round-trip test. `check:inventory` compares the screen inventory's canonical routes (query
strings stripped) against the same generated list, so there is one source of truth.

**Also fails on:** for every list surface (a `route`-kind screen with filters, a layout
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

**Key screens** are every `route`-kind row of the [screen inventory](screen-inventory.md) —
that document is the single source, so a screen added there gets its G8 baseline in the
same pull request rather than a second, separately-maintained list drifting from it.

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
sizes are measured by `size-limit` on the two entry bundles; field INP is observed in
production ([observability.md](../01-architecture/observability.md)), not gated in CI — a
shared runner cannot measure it.

**Measurement, per metric** (the harness this gate needs, not yet built):

| Metric | Tool | Throttling | Target route | Sample / flake policy |
| --- | --- | --- | --- | --- |
| LCP, CLS, route transition | Playwright, `PerformanceObserver` marks read via CDP | Network: Lighthouse's "Fast 4G" profile (1.6 Mbps down / 750 Kbps up / 150 ms RTT) via `Network.emulateNetworkConditions`; CPU: 4× slowdown via `Emulation.setCPUThrottlingRate` | `Work — list` (seeded, P1's canonical list surface) → `Work item — full page` for the transition row | Median of three runs; one automatic re-run on a failing sample before the build fails, per metric |
| Interaction latency (INP proxy) | Playwright, timestamped click-to-paint on the named core journeys (`G10`'s list) | Same profile as above | The journey's own screen | Median of three runs, same re-run policy |
| Board render (200 items) | Playwright, time from navigation to last row painted | Unthrottled — measures the app's own render cost, not the network | `Work — board`, seeded | Median of three runs |
| List render (500 rows) | Same method | Unthrottled | `Work — list`, seeded | Median of three runs |
| Board drag (p95 frame time) | Already specified above — a scripted 2 s drag, median of three runs | Unthrottled | `Work — board` | As stated in the table row |
| Agent / portal bundle size | `size-limit` | n/a | n/a | Single measurement; a regression fails immediately, no re-run (deterministic) |

CPU/network throttling applies only to the metrics a real user's device and connection
would affect (LCP, INP, CLS, route transition); render-time and bundle-size rows measure
the application's own work and are deliberately left unthrottled so a regression there is
never masked by throttling noise.

### G12 · Portal bundle purity

**Fails on:** any module under `routes/agent/` or `components/god-mode/` appearing in the
portal bundle's module graph (walked from the bundler's own metadata).

Achievable only with **two router trees**: two `tanstackRouter()` plugin instances
(`routes/agent`, `routes/portal`) generating two route trees, two Rollup inputs
(`entry.agent.tsx`, `entry.portal.tsx`) and two HTML files. kaneo's single generated
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

### H1 · Does it look like kaneo?

The comparison has an artefact: a **kaneo reference screenshot set** captured at P0 (the same
snapshot step that copies the code) and committed under `tests/visual/kaneo-reference/`, and
a written vocabulary — kaneo's `skills/` (`pick-ui-library`, `animation-vocabulary`,
`review-animations`, `apple-design`, `emil-design-eng`), linked from
[design-principles.md](design-principles.md). "Does it look like kaneo" is a comparison, not
a memory test.


Open kaneo. Open this. Would they sit next to each other without one looking wrong?

This is the primary question and it is asked every time.

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

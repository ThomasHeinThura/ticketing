# Design tokens

Every visual value is a token. Literal colours, arbitrary spacing and one-off radii are
lint errors outside `packages/ui`.

Tokens live in `packages/ui/src/styles/`:

- `tokens.css` — the primitive scales
- `theme.css` — semantic assignment per theme
- `motion.css` — duration and easing

This document is split by provenance, because the two halves carry different weight:
**inherited** tokens are copied verbatim from kaneo's `apps/web/src/index.css` and must not
drift from it; **authored** tokens are new work TaskDesk is adding, with no kaneo source to
check against.

## Two layers

**Primitive tokens** are raw values with no meaning: `--color-neutral-500`. **Semantic
tokens** give them a job: `--color-muted-foreground`, `--radius-md`.

Application code uses **only semantic tokens**, via Tailwind classes. This is what makes
theming and rebranding a variable change rather than a search-and-replace.

kaneo's real chain is two semantic hops, not one — a `:root` value, then a `@theme inline`
alias that gives Tailwind its class:

```
--color-neutral-800  →  --foreground  →  (@theme inline) --color-foreground  →  text-foreground
```

---

## Inherited from kaneo — verbatim

Everything in this section is copied exactly from `apps/web/src/index.css` at extraction.
Do not round the numbers or "clean up" the curves — matching kaneo bit-for-bit is the point
of [H1](ux-quality-gates.md#h1--does-it-look-like-kaneo).

### Colour base

Base scale is **neutral** (Tailwind's `neutral-*` ramp), not zinc. Accent is overridable at
runtime by instance branding.

### Semantic assignments

| Token | Tailwind class | Light | Dark |
| --- | --- | --- | --- |
| `--color-background` | `bg-background` | `--color-white` | `color-mix(neutral-950 96%, white)` |
| `--color-foreground` | `text-foreground` | `--color-neutral-800` | `--color-neutral-100` |
| `--color-card` | `bg-card` | `--color-white` | `color-mix(background 98%, white)` |
| `--color-popover` | `bg-popover` | `--color-white` | `color-mix(background 98%, white)` |
| `--color-muted` | `bg-muted` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-muted-foreground` | `text-muted-foreground` | `color-mix(neutral-500 90%, black)` | `color-mix(neutral-500 90%, white)` |
| `--color-border` | `border-border` | `--alpha(black / 8%)` | `--alpha(white / 6%)` |
| `--color-input` | `border-input` | `--alpha(black / 10%)` | `--alpha(white / 8%)` |
| `--color-ring` | `ring-ring` | `--color-neutral-400` | `--color-neutral-500` |
| `--color-primary` | `bg-primary` | `--color-neutral-800` | `--color-neutral-100` |
| `--color-secondary` | `bg-secondary` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-accent` | `bg-accent` | `--alpha(black / 4%)` | `--alpha(white / 4%)` |
| `--color-destructive` | `bg-destructive` | `--color-red-500` | `color-mix(red-500 90%, white)` |

There is **no `--color-danger`** — kaneo's breach/error role is `--destructive`. Every
colour above also has a `-foreground` counterpart for text placed on it
(`--destructive-foreground`, `--accent-foreground`, `--muted-foreground`, `--card-foreground`,
`--popover-foreground`, `--primary-foreground`, `--secondary-foreground`), listed once here
rather than doubled in the table.

### Status colours

Reserved. Do not use them decoratively — their scarcity is what makes them legible.

| Token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--success` / `--success-foreground` | `emerald-500` / `emerald-700` | `emerald-500` / `emerald-400` | Met SLA, completed, healthy |
| `--warning` / `--warning-foreground` | `amber-500` / `amber-700` | `amber-500` / `amber-400` | At-risk SLA, pending approval, degraded |
| `--info` / `--info-foreground` | `blue-500` / `blue-700` | `blue-500` / `blue-400` | Neutral informational |

(`--destructive` / `--destructive-foreground` carries the breached/failed/blocked role —
see the semantic table above. There is no separate `--danger` token.)

### Chart series

`--chart-1` … `--chart-5`, used by any chart primitive so `G3` contrast applies to series
colours. **Different in light and dark** — copy both, do not average them:

| Token | Light | Dark |
| --- | --- | --- |
| `--chart-1` | `orange-600` | `blue-700` |
| `--chart-2` | `teal-600` | `emerald-500` |
| `--chart-3` | `cyan-900` | `amber-500` |
| `--chart-4` | `amber-400` | `purple-500` |
| `--chart-5` | `amber-500` | `rose-500` |

### Code

`--code` (background), `--code-foreground`, `--code-highlight` — used by the code/`kbd`
family and the rich-text renderer's code blocks. `--code-foreground` is an alias of
`--foreground` in both themes; `--code` and `--code-highlight` are theme-specific mixes —
copy them from `index.css` rather than re-deriving.

### Radius

One root token plus four `calc()` derivations — **do not** hand-write four independent
px values, and do not copy shadcn's older 0.5rem-based scale:

```
--radius:     0.625rem                              (10px)
--radius-sm:  calc(var(--radius) - 4px)              (6px)   inputs, badges
--radius-md:  calc(var(--radius) - 2px)              (8px)   buttons, cards ← the default
--radius-lg:  var(--radius)                          (10px)  dialogs, popovers
--radius-xl:  calc(var(--radius) + 4px)              (14px)  large surfaces
```

There is **no `--radius-full` token** in kaneo. Where a fully-round corner is needed
(avatars, pills), use Tailwind's `rounded-full` utility directly rather than inventing a
token for it.

### Easing

kaneo defines **exactly two** easing curves, in the `@theme inline` block. There is no
third curve and no spring in CSS:

```
--ease-out:     cubic-bezier(0.23, 1, 0.32, 1)
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1)
```

See [Motion](motion.md) for which interactions use which curve.

### Reduced motion

Adopted verbatim from kaneo's rule, which deliberately does **not** collapse every duration
to zero — it keeps the opacity feedback and drops only movement and container morphs:

```css
@media (prefers-reduced-motion: reduce) {
  [data-slot="popover-popup"],
  [data-slot="select-popup"],
  [data-slot="menu-popup"],
  [data-slot="menu-sub-content"],
  [data-slot="tooltip-popup"],
  [data-slot="dialog-popup"],
  [data-slot="alert-dialog-popup"],
  [data-slot="command-dialog-popup"],
  [data-slot="sheet-popup"],
  [data-slot="toast-popup"] {
    transition-property: opacity !important;
  }

  [data-slot="sidebar-gap"],
  [data-slot="sidebar-container"],
  [data-slot="sidebar-group-content"],
  [data-slot="sidebar-menu-badge"] {
    transition: none !important;
  }

  /* dnd-kit writes the shuffle transition inline, so this needs !important. The
     dragged element still tracks the pointer; only the reflow is neutralized. */
  [data-kaneo-sortable] {
    transition: none !important;
  }
}
```

Carry the full `data-slot` list across unchanged — it is the enumeration of every popup
that must keep its fade — and keep the dnd-kit `!important` note; it is a real gotcha, not
decoration.

---

## Authored by TaskDesk

Nothing below exists in kaneo. It is new design-system work the extraction does not give
us for free, and it must be written and reviewed like any other design system change.

### Priority and SLA colour tokens

```
--color-priority-urgent    --color-priority-high
--color-priority-medium    --color-priority-low

--color-sla-ok        --color-sla-at-risk    --color-sla-breached
--color-sla-met       --color-sla-missed     --color-sla-none
```

**Provisional values**, derived from kaneo's existing amber/emerald/red/blue families so
they sit next to kaneo rather than introducing a new hue:

| Token | Provisional source |
| --- | --- |
| `--color-priority-urgent` | `--destructive` (red-500 family) |
| `--color-priority-high` | `--warning` (amber-500 family) |
| `--color-priority-medium` | `--info` (blue-500 family) |
| `--color-priority-low` | `--muted-foreground` (neutral) |
| `--color-sla-ok` / `--color-sla-met` | `--success` (emerald-500 family) |
| `--color-sla-at-risk` | `--warning` (amber-500 family) |
| `--color-sla-breached` / `--color-sla-missed` | `--destructive` (red-500 family) |
| `--color-sla-none` | `--muted-foreground` (neutral) |

Confirmed at extraction (H1) — these are a starting point for the first Storybook pass,
not a final palette. Do not treat the "provisional" values as locked until that review.

### Spacing, z-index, type scale, shadow, layout — deleted

The previous version of this document invented `--space-0..20`, `--z-base..--z-tooltip`,
`--text-xs..2xl`, `--shadow-sm/md/lg` and a set of layout tokens
(`--sidebar-width`, `--topbar-height`, `--detail-pane-width`, `--content-max-width`). None
of these exist anywhere in kaneo (`grep -c` for each prefix in `index.css` is 0) — they
were presented as extraction but were invented.

**Decided 2026-09-06, Claude Code, reversible:** TaskDesk uses Tailwind's built-in spacing,
z-index, type and shadow scales directly, exactly as kaneo does, rather than wrapping them
in a bespoke token layer. Component authors reach for `p-4`, `text-sm`, `z-50`,
`shadow-sm`, etc.; there is no `--space-*`/`--z-*`/`--text-*`/`--shadow-*` indirection to
maintain or drift from kaneo. If a real need for a semantic layout token
(`--sidebar-width`, `--detail-pane-width`) is found during extraction, add it here with a
value at that point — do not carry the old placeholder numbers forward.

Density-aware spacing (comfortable/compact) is still a real requirement — it stays as a
follow-up: whatever mechanism is chosen (semantic spacing tokens or a density class) is
recorded here once decided, rather than pre-populated with unverified numbers.

### Motion

See [Motion](motion.md) for the full rule. `--ease-spring` is **not valid CSS** —
`spring(1, 100, 15, 0)` is Framer Motion notation — so it does not live in `motion.css`.
It moves to `motion.ts` as a Framer Motion transition object instead:

```ts
export const springSettle = { type: "spring", stiffness: 100, damping: 15, mass: 1 };
```

`--ease-in` is **dropped**: kaneo's `plans/001-motion-tokens-and-easing.md` prescribes only
`--ease-out` and `--ease-in-out` (verified against the plan directly — it never defines an
`--ease-in`), and `index.css` defines the same two curves and no third. Motion.md's
"leaving uses `ease-in`" rule is corrected there to use one of the two real curves.

Reduced motion for `--duration-*` follows the same rule stated in the inherited section
above — durations are not all collapsed to `--duration-instant`; movement and container
morphs drop, opacity feedback stays.

### Contrast (G3)

Every foreground/background pair meets **WCAG AA**: 4.5:1 for body text, 3:1 for large
text and non-text indicators.

Most of kaneo's surface tokens are translucent or computed — `--alpha()` (a Tailwind v4
build-time function) and `color-mix()` — so a script reading the CSS source text cannot
produce a contrast ratio directly. The checker must:

1. Resolve colours from the **built** stylesheet, e.g. render each theme in headless
   Chromium and read `getComputedStyle`, rather than parsing source CSS.
2. Evaluate `--alpha()` and `color-mix()` by **compositing the translucent token over its
   effective backdrop** (the surface it is actually painted on in that pair), not in
   isolation.
3. Check every pair declared in `pairs.json` in both themes and fail on a violation.

`pairs.json` schema:

```json
{ "fg": "--color-muted-foreground", "bg": "--color-card", "minRatio": 4.5, "themes": ["light", "dark"] }
```

One entry per declared pair; `minRatio` is `4.5` for body text and `3` for large text and
non-text indicators.

Status must never be conveyed by colour alone. An SLA badge carries an icon and a label as
well as a colour.

## Typography

Geist Variable, Geist Mono Variable for keys, IDs and code.

Weights: 400 body, 500 emphasis, 600 headings. Nothing heavier — kaneo does not use bold
type for hierarchy, it uses size and colour.

Work item keys (`SUP-1234`) always render in Geist Mono, so they are recognisable and
selectable as a unit.

The type scale itself is Tailwind's built-in `text-*` utilities (see "Spacing, z-index,
type scale… deleted" above) rather than a bespoke `--text-*` token set.

## Breakpoints

```
sm   640px    md   768px    lg  1024px    xl  1280px    2xl 1536px
```

The meaningful application breakpoint is **900 px**, below which the agent sidebar
collapses to an icon rail and the portal switches to a bottom bar. Inherited from v1,
which got this right after its redesign.

## Enforcement

`scripts/check-tokens.mjs` runs in CI and fails on:

- A hex colour, `rgb()`, `hsl()`, `oklch()`, `color-mix(` or `--alpha(` outside
  `packages/ui/src/styles/`
- An arbitrary Tailwind value for colour, spacing, radius or z-index outside `packages/ui`
- A declared foreground/background pair (from `pairs.json`) failing contrast in either
  theme, per the compositing rule above
- A token referenced but not defined

## Adding a token

1. Is an existing token close enough? Almost always yes — use it.
2. If not, add the **primitive** to `tokens.css`.
3. Add the **semantic** alias to `theme.css` for both themes.
4. Extend the Tailwind preset so it has a class.
5. Check contrast.
6. Document it here, under "Authored by TaskDesk" unless it is copied from kaneo.

Adding a token is a design system change and gets reviewed as one.

## Related

- [Design system](design-system.md) · [Motion](motion.md)
- [Accessibility](accessibility.md) · [UX quality gates](ux-quality-gates.md)

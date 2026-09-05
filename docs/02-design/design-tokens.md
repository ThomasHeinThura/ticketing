# Design tokens

Every visual value is a token. Literal colours, arbitrary spacing and one-off radii are
lint errors outside `packages/ui`.

Tokens live in `packages/ui/src/styles/`:

- `tokens.css` — the primitive scales
- `theme.css` — semantic assignment per theme
- `motion.css` — duration and easing

## Two layers

**Primitive tokens** are raw values with no meaning: `--zinc-500`, `--space-4`.
**Semantic tokens** give them a job: `--color-muted-foreground`, `--radius-md`.

Application code uses **only semantic tokens**, via Tailwind classes. This is what makes
theming and rebranding a variable change rather than a search-and-replace.

```
--zinc-950  →  --color-background (dark)  →  bg-background
```

## Colour

Base scale is zinc, from kaneo. Accent is overridable at runtime by instance branding.

### Semantic assignments

| Token | Tailwind class | Use |
| --- | --- | --- |
| `--color-background` | `bg-background` | Page |
| `--color-foreground` | `text-foreground` | Body text |
| `--color-card` | `bg-card` | Raised surface |
| `--color-popover` | `bg-popover` | Floating surface |
| `--color-muted` | `bg-muted` | Recessed surface |
| `--color-muted-foreground` | `text-muted-foreground` | Secondary text |
| `--color-border` | `border-border` | Dividers, outlines |
| `--color-input` | `border-input` | Field borders |
| `--color-ring` | `ring-ring` | Focus ring |
| `--color-primary` | `bg-primary` | Primary action |
| `--color-secondary` | `bg-secondary` | Secondary action |
| `--color-accent` | `bg-accent` | Hover, selection |
| `--color-destructive` | `bg-destructive` | Delete, breach, error |

### Status colours

Reserved. Do not use them decoratively — their scarcity is what makes them legible.

| Token | Meaning |
| --- | --- |
| `--color-success` | Met SLA, completed, healthy |
| `--color-warning` | At-risk SLA, pending approval, degraded |
| `--color-danger` | Breached SLA, failed, blocked |
| `--color-info` | Neutral informational |

### Priority

```
--color-priority-urgent    --color-priority-high
--color-priority-medium    --color-priority-low
```

### SLA

```
--color-sla-ok        --color-sla-at-risk    --color-sla-breached
--color-sla-met       --color-sla-missed     --color-sla-none
```

### Contrast

Every foreground/background pair meets **WCAG AA**: 4.5:1 for body text, 3:1 for large
text and non-text indicators. A script in CI evaluates every declared pair in both themes
and fails on a violation — inherited from v1's `check-tokens.mjs`, which was one of its
better ideas.

Status must never be conveyed by colour alone. An SLA badge carries an icon and a label as
well as a colour.

## Spacing

A 4 px base scale.

```
--space-0  0      --space-1  4px    --space-2  8px    --space-3  12px
--space-4  16px   --space-5  20px   --space-6  24px   --space-8  32px
--space-10 40px   --space-12 48px   --space-16 64px   --space-20 80px
```

Density-aware semantic tokens, so the comfortable/compact preference works everywhere:

| Token | Comfortable | Compact |
| --- | --- | --- |
| `--space-row-y` | 12px | 8px |
| `--space-card-p` | 16px | 12px |
| `--space-section-gap` | 24px | 16px |
| `--space-field-gap` | 16px | 12px |

Components use the semantic tokens. Hard-coding `py-3` on a table row defeats the
preference.

## Typography

Geist Variable, Geist Mono Variable for keys, IDs and code.

| Token | Size / line-height | Use |
| --- | --- | --- |
| `--text-xs` | 12 / 16 | Metadata, timestamps |
| `--text-sm` | 14 / 20 | Body — the default |
| `--text-base` | 16 / 24 | Emphasis |
| `--text-lg` | 18 / 28 | Section heading |
| `--text-xl` | 20 / 28 | Page heading |
| `--text-2xl` | 24 / 32 | Display |

Weights: 400 body, 500 emphasis, 600 headings. Nothing heavier — kaneo does not use bold
type for hierarchy, it uses size and colour.

Work item keys (`SUP-1234`) always render in Geist Mono, so they are recognisable and
selectable as a unit.

## Radius

```
--radius-sm   4px    inputs, badges
--radius-md   6px    buttons, cards        ← the default
--radius-lg   8px    dialogs, popovers
--radius-xl  12px    large surfaces
--radius-full        avatars, pills
```

## Shadow

Sparing. kaneo uses borders and background steps for depth far more than shadow.

```
--shadow-sm    subtle lift        cards on hover
--shadow-md    floating           dropdowns, popovers
--shadow-lg    modal              dialogs, sheets
```

## Z-index

Named, so nobody ever writes `z-[9999]`.

```
--z-base        0
--z-sticky     10    sticky headers
--z-dropdown   20
--z-overlay    30    dialog backdrop
--z-modal      40
--z-popover    50
--z-toast      60
--z-tooltip    70
```

## Motion

See [Motion](motion.md). Summary:

```
--duration-instant   0ms      --duration-fast     100ms
--duration-normal  200ms      --duration-slow     300ms

--ease-out      cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out   cubic-bezier(0.65, 0, 0.35, 1)
--ease-spring   spring(1, 100, 15, 0)
```

Under `prefers-reduced-motion`, all durations resolve to `--duration-instant`.

## Layout

```
--sidebar-width           256px
--sidebar-width-collapsed  48px
--topbar-height            48px
--detail-pane-width       420px    (resizable, persisted per user)
--content-max-width      1440px
```

## Breakpoints

```
sm   640px    md   768px    lg  1024px    xl  1280px    2xl 1536px
```

The meaningful application breakpoint is **900 px**, below which the agent sidebar
collapses to an icon rail and the portal switches to a bottom bar. Inherited from v1,
which got this right after its redesign.

## Enforcement

`scripts/check-tokens.mjs` runs in CI and fails on:

- A hex colour, `rgb()`, `hsl()` or `oklch()` outside `packages/ui/src/styles/`
- An arbitrary Tailwind value for colour, spacing, radius or z-index outside `packages/ui`
- A declared foreground/background pair failing contrast in either theme
- A token referenced but not defined

## Adding a token

1. Is an existing token close enough? Almost always yes — use it.
2. If not, add the **primitive** to `tokens.css`.
3. Add the **semantic** alias to `theme.css` for both themes.
4. Extend the Tailwind preset so it has a class.
5. Check contrast.
6. Document it here.

Adding a token is a design system change and gets reviewed as one.

## Related

- [Design system](design-system.md) · [Motion](motion.md)
- [Accessibility](accessibility.md) · [UX quality gates](ux-quality-gates.md)

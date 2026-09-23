# Design system

`packages/ui` — extracted from kaneo, owned by us, the only source of UI primitives.

## Foundations

| | |
| --- | --- |
| Base | shadcn/ui, `new-york` style |
| Primitives | Base UI (`@base-ui/react`); Radix only per `packages/ui/KNOWN-RADIX.md` |
| Colour base | neutral |
| Styling | Tailwind CSS v4, CSS variables |
| Variants | class-variance-authority |
| Icons | lucide-react — the only icon source |
| Typography | Geist Variable / Geist Mono Variable |
| Motion | Framer Motion, tokenised |
| Catalogue | Storybook 10 |
| Charting | Recharts (Thomas, 2026-09-23 — see [decision log](../07-planning/decision-log.md)) |
| Dashboard layout | react-grid-layout (Thomas, 2026-09-23 — see [decision log](../07-planning/decision-log.md)) |

## Package layout

```
packages/ui/
├── src/
│   ├── components/          the primitives
│   ├── styles/
│   │   ├── tokens.css       colour, spacing, radius, shadow, z-index
│   │   ├── theme.css        light/dark variable assignment
│   │   └── motion.css       duration and easing tokens
│   ├── hooks/               use-media-query, use-controllable-state, …
│   ├── lib/                 cn(), variant helpers
│   └── tailwind-preset.ts   consumed by apps/web
├── .storybook/
└── package.json
```

`apps/web` imports the preset and the components. It defines no primitives of its own.

## The primitives

Taken from kaneo. Every one has a Storybook story and passes axe.

List regenerated from `ls apps/web/src/components/ui` (63 files, checked 2026-09-06), not
from memory. kaneo names two of these differently than shadcn convention (`menu`, not
`dropdown-menu`; `preview-card`, not `hover-card`) and has `calendar` where the doc
previously said `date-picker`/`date-range-picker` — use kaneo's real names below.

**Layout** — `sidebar` `breadcrumb` `separator` `scroll-area` `frame` `group`

**Forms** — `button` `input` `textarea` `checkbox` `checkbox-group` `radio-group` `select`
`combobox` `autocomplete` `switch` `toggle` `toggle-group` `slider` `input-otp`
`input-group` `number-field` `shortcut-number` `calendar` `field` `fieldset` `label` `form`

**Overlays** — `dialog` `alert-dialog` `sheet` `popover` `preview-card` `tooltip`
`context-menu` `menu` `menubar` `command`

**Display** — `card` `badge` `avatar` `table` `progress` `circular-progress` `meter`
`pagination` `timeline` `skeleton` `empty` `alert` `kbd`

**Disclosure** — `accordion` `collapsible` `tabs`

**Feedback** — `toast` `spinner` `error-boundary` `error-display` `error-fallback`
`loading-skeleton` `toolbar`

Twelve primitives this document previously listed **do not exist in kaneo** and are not
"taken from kaneo": `resizable`, `aspect-ratio`, `multi-select`, `date-picker`,
`date-range-picker`, `drawer`, `hover-card` (kaneo: `preview-card`), `dropdown-menu`
(kaneo: `menu`), `avatar-group`, `data-table`, `code`, `user-menu`. If a service desk needs
one of these, it is new work — build it from kaneo's primitives, mark it **authored, not
extracted** in "What we add for TaskDesk" below, and budget it; do not assume it ships free
with the extraction.

## Navigation — app-shell composites, extracted separately

`nav-main` `nav-projects` `workspace-switcher` live at kaneo's `apps/web/src/components/*`,
not `components/ui/` — they are feature composites, not primitives (`nav-projects.tsx`
imports dnd-kit and is project-aware, which the rule below forbids in a primitive). They
move to `apps/web/src/components/app-shell/` alongside the extraction, not into
`packages/ui`. `user-menu` does not exist in kaneo (kaneo has `user-avatar.tsx`, a smaller
primitive) — build the menu from `avatar` + `menu`, marked **authored, not extracted**.

## What we add for TaskDesk

New primitives needed by a service desk. They live in `packages/ui` like everything else,
and they must look as though they shipped with the system.

| Primitive | Purpose |
| --- | --- |
| `sla-badge` | `ok` / `at-risk` / `breached` / `met` / `missed` / `none`, with remaining time |
| `sla-bar` | Consumed-time progress bar with a threshold marker |
| `priority-select` | Urgent / High / Medium / Low, with the escalate-only variant for customers |
| `state-select` | State picker that offers only legal transitions for the current role |
| `person-picker` | Avatar + name + role, scoped to the project roster |
| `approval-card` | Approver, status, expiry, decision affordance |
| `capability-matrix` | The grouped tick-box grid used to edit a role |
| `plugin-config-form` | Renders a form from a Zod schema — the God Mode workhorse |
| `visibility-toggle` | Public / internal, used on comments and attachments |
| `duration-input` | Hours and minutes, storing integer minutes |
| `calendar-window-editor` | Weekday coverage windows for a service calendar |
| `form-builder` | Drag-to-arrange request type form designer |
| `chart` | Wraps Recharts. `bar` / `line` / `number` variants for `reports-and-dashboards.md`'s three chart types |
| `chart-table` | The accessible table equivalent `RP-11` requires, rendered alongside every `chart` instance |
| `dashboard-grid` | Wraps react-grid-layout. Resizable, draggable dashboard widgets whose layout persists (`RP-15`) |

**`chart`'s contract:** series colours are drawn only from a fixed token ramp
(`--chart-series-1` … `--chart-series-n` in `tokens.css`), never a colour Recharts or a
caller picks freely — this is what lets `G3` check chart contrast the same way it checks
every other token. `chart` never renders alone: every instance renders its `chart-table`
alongside it (visually hidden by default, reachable by keyboard, per `RP-11`), not as an
optional companion a screen may skip. A screen that renders a `chart` without its
`chart-table` fails `G4`.

**`dashboard-grid`'s keyboard path**, stated the way
[`accessibility.md`](accessibility.md#keyboard) states dnd-kit's
for board drag, because react-grid-layout's own drag/resize handles
(`react-draggable`/`react-resizable`) are mouse- and touch-first with no keyboard
equivalent of their own: focus a widget's drag handle, `Enter` to enter move-or-resize
mode, arrow keys to move the widget by one grid cell, `Shift`+arrow keys to resize it by
one grid cell, `Enter` to confirm the new position and persist it, `Escape` to cancel and
restore the prior position — with live-region announcements at each step, the same shape
as the board-drag path. Without this, `dashboard-grid` lands in the Known-exceptions
table by default, which `RP-15` does not allow for a P4-governed feature.

`time-and-cost.md`'s timesheet ("a week grid, person by day, with inline entry, keyboard
navigation between cells") is not a thirteenth new primitive. It composes the existing
`data-table` (see "Twelve primitives ... do not exist in kaneo" above — `data-table` is
authored, not extracted) with an editable-cell variant: each body cell renders an
inline `duration-input` on focus/click rather than plain text, and column headers are the
seven weekdays rather than record fields. This is chosen over a dedicated `grid-editor`
primitive because the two components would share every structural concern — column
headers, row virtualisation for a long roster, keyboard navigation between cells — and a
timesheet is, structurally, a table whose cells happen to be editable, not a distinct
widget shape the way `dashboard-grid` (see below) is.

## Adding a primitive

1. Check kaneo first. If it exists there, take it rather than writing it.
2. Build on a Base UI primitive where one exists. Do not reimplement focus management.
3. Tokens only — no literal colours, no arbitrary spacing.
4. Use `cva` for variants. Support `className` passthrough and `asChild` where sensible.
5. Forward refs. Spread `...props`.
6. Write the Storybook story: default, every variant, every size, disabled, loading,
   error, and a long-content case.
7. Write the test: renders, keyboard-operable, axe clean.
8. Support light and dark.
9. Support `prefers-reduced-motion` if it animates.

The build fails if an exported component has no story.

## Composition rules

```
packages/ui/components/       primitives          — know nothing about the domain
apps/web/src/components/      feature composites  — know about work items
apps/web/src/routes/          screens             — assemble composites
```

A primitive that imports a type from the domain is in the wrong place.

```tsx
// ✗ never
<button className="rounded bg-blue-500 px-3 py-1.5">Save</button>

// ✓ always
<Button variant="default" size="sm">Save</Button>
```

## Application shell

Taken from kaneo unchanged.

**Agent** — collapsible sidebar with workspace switcher, primary navigation and project
list; topbar with breadcrumb, search, notification bell and user menu; command palette on
`⌘K`. Below 900 px the sidebar becomes an icon rail.

**Portal** — the same shell, dramatically simplified: a short navigation list, no
workspace switcher, no command palette by default. Same components, less of them.

## Icons

`lucide-react`, and nothing else. Never an inline SVG, never a second icon library,
never an emoji as an icon.

v1 shipped buttons with empty icon paths because icons were referenced from a map that
had gaps. Importing icons directly makes that failure impossible for **code** — a missing
icon there is a compile error. But `project.icon`, `work_item_type.icon` and
`request_type.icon` ([data model](../01-architecture/data-model.md)) are **data**, chosen
at runtime by an administrator, not by a developer importing a named component — the same
class of gap v1 hit, just moved from code to configuration.

So: a stored icon value is a **lucide icon name** (e.g. `"circle-alert"`, the kebab-case
name `lucide-react` exports as a component), validated against a checked-in allowlist —
`packages/ui/src/lib/icon-names.ts`, generated from the installed `lucide-react` version
so it can never name an icon that package does not ship. The icon picker offers only
allowlisted names; nothing writes a `project.icon`/`work_item_type.icon`/
`request_type.icon` value outside that list. When a stored name is not on the current
allowlist — a downgraded `lucide-react` version, or a row written before an icon was
renamed upstream — it renders the documented fallback icon (`circle-help`), never a gap
and never a compile error at runtime.

## Theming

Light and dark, driven entirely by CSS variables in `theme.css`. A component never
branches on theme; it uses semantic tokens (`bg-background`, `text-muted-foreground`)
which resolve per theme.

Instance branding overrides a small, bounded, named set of CSS variables at runtime,
injected from `/api/public/branding`. No rebuild. This is the same list named in
[`plugin-architecture.md`](../01-architecture/plugin-architecture.md#branding) and
[`configuration-reference.md`](../05-operations/configuration-reference.md#branding) —
one list, cited in three places, not three lists that can drift apart:

| Variable | Backs |
| --- | --- |
| `--brand-accent` | Accent colour — primary buttons, links, focus rings |
| `--brand-logo-light` | Logo shown on a light background |
| `--brand-logo-dark` | Logo shown on a dark background |
| `--brand-login-background` | Login page background image or colour |
| `--brand-favicon` | Favicon |

Nothing outside this list is accepted. An administrator cannot submit an arbitrary CSS
variable name or value — `/api/public/branding`'s write path rejects any key not in the
table above, server-side, before it reaches `instance_branding`. This is a styling-
injection surface otherwise: an unbounded "custom CSS variable override" lets an
administrator write anything the theme engine will interpolate into the page.

`--brand-accent` is run through the same contrast check `G3` runs over the committed
tokens ([`ux-quality-gates.md`](ux-quality-gates.md#g3--contrast)), against both the light
and dark `--background` it will pair with. A submission that fails AA contrast is not
silently accepted — God Mode shows the computed ratio and a warning before save, the same
shape as any other validated form field. `G3`'s own CI check only ever sees the committed
tokens; this runtime check is God Mode's job, not CI's, because the value does not exist
until an administrator saves it.

## Storybook

Runs at `pnpm --filter @taskdesk/ui storybook`, deployed alongside the documentation site,
and is the canonical catalogue. Every primitive appears with all its states.

Visual snapshots run against Storybook so an unintended visual change to a primitive fails
the build rather than being discovered on a screen three weeks later — see
[G8](ux-quality-gates.md#g8--visual-regression) for the tool, which is not yet chosen.

## Attribution

`packages/ui` contains substantial verbatim kaneo code under MIT. Copyright headers stay.
See [Licensing and attribution](../00-overview/licensing-and-attribution.md).

## Related

- [Design tokens](design-tokens.md) · [Design principles](design-principles.md)
- [Motion](motion.md) · [Accessibility](accessibility.md)
- [ADR 0008](../01-architecture/adr/0008-single-design-system.md)

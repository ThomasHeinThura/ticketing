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
had gaps. Importing icons directly makes that failure impossible — a missing icon is a
compile error.

## Theming

Light and dark, driven entirely by CSS variables in `theme.css`. A component never
branches on theme; it uses semantic tokens (`bg-background`, `text-muted-foreground`)
which resolve per theme.

Instance branding overrides a small set of variables at runtime — accent colour, logo,
login background — injected from `/api/public/branding`. No rebuild.

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

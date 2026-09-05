# Design system

`packages/ui` — extracted from kaneo, owned by us, the only source of UI primitives.

## Foundations

| | |
| --- | --- |
| Base | shadcn/ui, `new-york` style |
| Primitives | Radix UI |
| Colour base | zinc |
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

**Layout** — `sidebar` `breadcrumb` `separator` `scroll-area` `resizable` `frame` `group`
`aspect-ratio`

**Forms** — `button` `input` `textarea` `checkbox` `radio-group` `select` `combobox`
`autocomplete` `multi-select` `switch` `toggle` `toggle-group` `slider` `input-otp`
`number-field` `date-picker` `date-range-picker` `field` `fieldset` `label` `form`

**Overlays** — `dialog` `alert-dialog` `sheet` `drawer` `popover` `hover-card` `tooltip`
`context-menu` `dropdown-menu` `menubar` `command`

**Display** — `card` `badge` `avatar` `avatar-group` `table` `data-table` `progress`
`circular-progress` `meter` `pagination` `timeline` `skeleton` `empty` `alert` `kbd`
`code`

**Disclosure** — `accordion` `collapsible` `tabs`

**Feedback** — `toast` `spinner` `error-boundary` `error-display`

**Navigation** — `nav-main` `nav-projects` `workspace-switcher` `user-menu`

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
2. Build on a Radix primitive where one exists. Do not reimplement focus management.
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

Chromatic-style visual snapshots run against Storybook in CI, so an unintended visual
change to a primitive fails the build rather than being discovered on a screen three weeks
later.

## Attribution

`packages/ui` contains substantial verbatim kaneo code under MIT. Copyright headers stay.
See [Licensing and attribution](../00-overview/licensing-and-attribution.md).

## Related

- [Design tokens](design-tokens.md) · [Design principles](design-principles.md)
- [Motion](motion.md) · [Accessibility](accessibility.md)
- [ADR 0008](../01-architecture/adr/0008-single-design-system.md)

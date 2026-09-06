# `packages/ui` extraction plan

kaneo has **no design-system package** — its primitives live inside `apps/web/src/components/ui`,
and they are **already a Base UI set** (checked against kaneo's source 2026-09-06): 43 of
63 import `@base-ui/react`; one (`form.tsx`) imports `@radix-ui/react-slot` for `Slot`,
`timeline.tsx` takes `Slot` from the `radix-ui` umbrella package, and 17 of the 18
`@radix-ui/*` dependencies in `apps/web/package.json` have no references at all. [ADR 0008](../01-architecture/adr/0008-single-design-system.md)
is honest that extraction is real work; this is the plan. Written 2026-09-05.

## Primitive library — decided: Base UI

| Option | For | Against |
| --- | --- | --- |
| **Base UI** (chosen, 2026-09-05) | shadcn's current default; MUI-backed; API-compatible with the Radix components it replaces; where kaneo is heading | Newer; a few primitives kaneo still uses only exist in Radix |
| Radix | Mature; most of kaneo's current components | shadcn no longer defaults to it; kaneo is migrating away |
| Both, indefinitely | No migration cost | Two focus/portal/scroll-lock models in one package; "accessibility comes from one library" becomes untrue |

**Decision (Thomas, 2026-09-05): Base UI is the primary UI primitive standard.** During
extraction the count actually found is **one live Radix use — `Slot`**; the 17 unused
`@radix-ui/*` dependencies are simply not copied, and `KNOWN-RADIX.md` starts with at most
one row. Retain Radix **only** as a
documented temporary exception where Base UI lacks a required primitive — behind the same
`packages/ui` export, listed in `packages/ui/KNOWN-RADIX.md` with the reason and a date to
revisit. **Feature code imports only from `@taskdesk/ui`**, never from `@radix-ui/*` or
`@base-ui/react` directly — `check:ui` fails the build on any import of `@radix-ui/*`, the
`radix-ui` umbrella or `@base-ui/react` outside `packages/ui`, and inside `packages/ui` on
any Radix import not listed in `KNOWN-RADIX.md`, which is a table with fixed columns
(primitive · module specifier · reason · revisit date) that the check parses. Re-exports
from `@taskdesk/ui` pass, because the check scans import specifiers, not exported symbols. Two unmanaged primitive
systems are not kept indefinitely: the exception register is reviewed at every phase gate.

## What moves

| From `apps/web/src/` | To `packages/ui/src/` |
| --- | --- |
| `components/ui/*` | `primitives/*` — one file per primitive, one story, one test; `error-boundary.tsx` is **de-Sentry'd before it moves** (fork-time removal list) |
| Tailwind v4 theme (`index.css` CSS variables, `@theme`) | `theme.css` + `tailwind-preset.ts`; **every token gets a value** in light and dark ([design-tokens.md](design-tokens.md)) |
| `lib/cn.ts` (`cn`, 99 importers) | `lib/cn.ts` — `lib/utils.ts`, a byte-identical duplicate with 5 importers, is deleted and its importers repointed in the codemod |
| Icon usage | `icons.ts` — the lucide allowlist the `icon` columns store names from |
| Motion tokens (`plans/001`) | `motion.ts` — including the spring as a Framer Motion object, not CSS |

Nothing feature-specific moves: `packages/ui` knows no work items.

## Additions the specs need

`capability-matrix`, `plugin-config-form`, `sla-badge`, `state-select` (only legal
transitions), `chart` / `chart-table` (Recharts wrapped, series colours from a token ramp
so `G3` applies), `dashboard-grid` (with a keyboard path), `grid-editor` (the timesheet's
editable week grid), `terminology`-aware `Trans` helper.

## Mechanics

1. Create `packages/ui` with its own `package.json`, `tsconfig` from
   `packages/typescript-config`, Tailwind preset, and Storybook 10.
2. Move primitives one by one; each move updates imports via a codemod
   (`@/components/ui/button` → `@taskdesk/ui`), adds a story, adds a render + keyboard +
   axe test.
3. `check:ui` (`G1`) turns on the moment the first primitive moves, so nothing new lands in
   `apps/web/src/components/ui`.
4. The design-token values and the contrast-pair manifest (`pairs.json`) land with the
   theme, so `G3` runs on the first PR.
5. Delete `apps/web/src/components/ui` when empty.

## Exit

Storybook renders every primitive in light and dark; `G1`, `G3`, `G7` pass; both bundles
build against `@taskdesk/ui`; the decision log records the library chosen and the primitive
count.

## Related

- [Design system](design-system.md) · [Design tokens](design-tokens.md) · [ADR 0008](../01-architecture/adr/0008-single-design-system.md)
- [Repository bootstrap](../04-engineering/repository-bootstrap.md)

## Two entries, two route trees — P0 work this plan depends on

kaneo has one `index.html`, one `main.tsx` and one generated `routeTree.gen.ts` with 49 static
route imports, so "two entries, one source" is not a build flag. The split is: two
`tanstackRouter()` plugin instances in `vite.config.ts` with separate `routesDirectory`
(`src/routes/agent`, `src/routes/portal`) and `generatedRouteTree` outputs; two Rollup
inputs (`entry.agent.tsx`, `entry.portal.tsx`) and two HTML files; shared components under
`components/`; `lib/routes.ts` **generated** from the two trees (never hand-maintained) so
`G5` and `check:inventory` compare against one source of truth; and `G12` walking the portal
bundle's module graph from the bundler's metadata. Listed in
[phases.md](../07-planning/phases.md) P0.

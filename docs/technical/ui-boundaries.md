# UI import boundary

Use `packages/ui` and original Kaneo components. The import registry below has zero exceptions.
`check:ui` rejects unregistered Radix imports and stale entries. A new exception requires a
concrete approved reason, not a row added merely to silence the checker. Necessary semantic
HTML is governed by the existing raw-element checks and precise source explanations.

| File | Package | Reason |
| --- | --- | --- |

## Retained extraction and interaction constraints

Base UI through `@taskdesk/ui` is the primary primitive standard. Feature code imports neither Base UI nor Radix directly. A necessary temporary Radix primitive stays behind the same UI export with an explicit reason and revisit date; two unmanaged focus/portal/scroll-lock systems are not a permanent design. The machine registry above is authoritative for current exceptions, not the historical fork-time count.

Shared primitives, `cn`, the icon allowlist, theme and motion tokens belong in `packages/ui`; feature-specific work-item behavior does not. Remove inherited Sentry coupling from the shared error boundary. Consolidate duplicate utility implementations and import paths. Every theme token has light/dark values; chart series use token ramps and measured contrast. Preserve the original spring as the established motion-library object rather than replacing it with CSS easing. Exact values and reduced-motion behavior are retained in the design reference.

Each primitive has a story, render/keyboard/accessibility coverage and both themes. Shared additions retain capability matrices, schema-driven provider forms, SLA badges, legal-state selectors, chart/table alternatives, keyboard dashboard/timesheet grids and terminology-aware text. These are required capabilities, not claims that all exist or permission to add a dependency without approval. Both bundles consume shared primitives; empty legacy UI directories are not revived.

Agent and portal have separate entry HTML, route trees and generated metadata, sharing appropriate components. The retained generation target derives URL registration from those trees rather than inventing a second route authority; verify it separately from the current requirement to register URL state in `apps/web/src/lib/routes.ts`. Portal bundle graph inspection must demonstrate isolation. Local raw-UI/import checks alone do not establish that generation or browser-boundary proof. Current AGENTS governs implementation and the one phase review; old extraction step ordering and per-change review rules are inactive.

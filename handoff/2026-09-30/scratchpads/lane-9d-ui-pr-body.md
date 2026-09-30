## Task

Batch 4 of issue #9's `packages/ui` extraction: moves seven leaf primitives from the
overlay/menu family (alert-dialog, autocomplete, command, context-menu, menu, menubar,
select) from `apps/web/src/components/ui` into `@taskdesk/ui`, following PR #274's and
PR #280's pattern.

**Spec:** docs/02-design/ui-extraction-plan.md (issue #9). This is a relocation-only batch; see the decision log, 2026-09-23, "#9's primitive batches cite `ui-extraction-plan.md`"
**Rules in scope:** AGENTS.md rule 1 (no bespoke UI primitives outside `packages/ui`)

## Implemented by

**Model:** Sonnet 5
**Session:** lane-9d-ui (P0 burn-down, #9 batch 4)

## Reviewed by

**Model:** pending — independent fresh-context review not yet run
**Session:** pending

## Security review

**Model:** n/a
**Session:** n/a
**Surfaces examined:** none — no `package.json`, lockfile, `pnpm-workspace.yaml` override,
auth/permissions code, or migration touched. This is a pure UI-primitive relocation and
import-path rewrite within `apps/web` and `packages/ui`; no dependency was added (verified:
every moved primitive uses only `@base-ui/react/*`, `class-variance-authority`, the
existing `cn()` re-export, and already-moved package-internal siblings — `input`,
`scroll-area` — all already declared in `packages/ui/package.json`/already exported from
`packages/ui/src/index.ts`). Not a security-scope path per `docs/04-engineering/ci-cd.md`.

## Screens opened

Opened in a real browser: headless Chromium (Playwright's cached `chromium-1243`, driven
from a throwaway script outside the repo at `/home/ubuntu/.agent-tmp/lane9d-shots/`,
launched with an explicit `executablePath`), against a throwaway API and a private
Postgres database (`lane9d_browser_test`) on loopback (`td-lane-pg`, port 55440). The API
was bound to `localhost:1337` (both `KANEO_API_URL` and `TASKDESK_AGENT_URL` set to that
origin so better-auth's origin check and cookie domain agree — the API serves the built
`apps/web/dist` itself). The first user was signed up through the real setup-token flow,
then a workspace ("Lane 9D Workspace"), a project ("Design System"), and a task
("DS-1: Review menu primitives") were created through the actual UI.

| Screen | Route | Viewport | Action | Result |
| --- | --- | --- | --- | --- |
| Board → user avatar menu | `/dashboard/workspace/.../board` | 1440×900 | clicked the "TA" avatar, pressed ArrowDown then Escape | `Menu` popup opened (`data-slot="menu-popup"`, computed `border-radius: 10px`, `position: relative`), highlighted the first item on ArrowDown, closed on Escape |
| Board → mobile project/view menu | same | 390×844 | tapped the hamburger icon (mobile nav), pressed Escape | Menu-based popup opened listing View (Backlog/Board/Calendar/Gantt) and Projects with a checkmark on the active one; closed on Escape |
| Settings → Account → Preferences → Theme | `/dashboard/settings/account/preferences` | 1440×900 | clicked the Theme combobox, pressed ArrowDown then Enter | `Select` popup opened listing Light/Dark (checked)/System; Enter committed the highlighted option and closed the popup |
| Settings → Account → Preferences → Theme | same | 390×844 | clicked the combobox, pressed Escape | Popup opened then closed on Escape without changing the value |
| Board → task card (right-click) | `/dashboard/workspace/.../board` | 1440×900, 390×844 | right-clicked the task card, pressed ArrowDown then Escape (1440) / Escape (390) | `ContextMenu` opened (`role="menu"`) with Copy link / Priority▸ / Status▸ / Due date▸ / Assignee▸ / Archive / Mark as planned / Delete…; computed style on `[data-slot="context-menu-content"]`: `border-radius: 10px`; closed on Escape at both viewports |
| Board → task card context menu → Delete | same | 1440×900 | clicked "Delete…", then pressed Escape | `AlertDialog` opened (`role="alertdialog"`) titled "Delete Task?" with Cancel/Delete Task actions and a dimmed backdrop; closed on Escape without deleting (task still present afterward) |
| Board → search command palette | `/dashboard/workspace/.../board` | 1440×900 | clicked the sidebar "Search" control, typed "design", pressed ArrowDown then Escape | `Command`/`Autocomplete` dialog opened (`role="dialog"`), live-filtered to the "Design System" project under a "Projects" group as typed, highlighted it on ArrowDown, closed on Escape |

No console errors were recorded on any of the above pages (`page.on("console"/"pageerror")`
was attached for every screen).

`Menubar` and the standalone `Autocomplete` composition have no reachable screen in this
environment: `menubar.tsx` has no importer in `apps/web` today (same situation batch 2's
`toggle-group` and batch 3's `checkbox-group`/`input-group`/`toggle-group` were already in
— confirmed by grep before moving it), and `Autocomplete` is only reachable in this app
through `Command` (its only current importer), which was exercised directly above and
exercises `Autocomplete` internally. Both rely on their colocated tests, typecheck, lint
and (for `Autocomplete`) the dist-CSS check instead.

Afterward: the API process was killed (`pkill -9 -f worktrees/lane-9d-ui`), and
`lane9d_browser_test` was dropped.

## Gates

| Gate | Result (pass / n/a / waived) | Decision-log link |
| --- | --- | --- |
| G1 — No bespoke primitives | n/a | none (not waived — gate incomplete, not skipped; see G1 note) |
| G2 — Tokens only | n/a | |
| G3 — Contrast | n/a | |
| G4 — Accessibility | n/a | |
| G5 — Every screen has a URL | n/a | |
| G6 — Every screen has four states | n/a | |
| G7 — Storybook coverage | n/a | |
| G8 — Visual regression | n/a | |
| G9 — Reduced motion | n/a | |
| G10 — Keyboard reachability | n/a | |
| G11 — Performance budgets | n/a | |
| G12 — Portal bundle purity | n/a | |
| G13 — No layout shift on data arrival | n/a | |
| Route coverage (`test:permissions`) | n/a | |
| Permission matrix | n/a | |

No gate is waived. Reasons, following #274's/#280's precedent (unchanged premises, same
gate-incompleteness):

**G1 note:** same three-part gate as #63/#274/#280 (G1a raw elements, G1b import boundary,
G1c old directory empty). `check:ui` (Radix-import tracking): 0 unlisted, 0 tracked rows,
all current. `apps/web/scripts/check-ui-boundaries.mjs` (the `packages/ui` ⇄ `apps/web`
import boundary): OK, 74 `packages/ui` files / 478 `apps/web` files scanned. Neither is the
full G1a or G1c: `apps/web/src/components/ui` still has 18 files (17 primitives to move
plus the `error-test.tsx` harness) — `avatar.tsx` and `error-boundary.tsx` still
un-de-Sentry'd, `form.tsx`/`timeline.tsx` still on Radix `Slot`, `breadcrumb.tsx`/
`pagination.tsx` still depend on `react-i18next`/an app-local `i18n` module, `dialog.tsx`/
`sheet.tsx`/`combobox.tsx` depend on that same `i18n` module, and `input-otp.tsx` depends
on the `input-otp` npm package (a dependency of `apps/web`, not of `packages/ui`). n/a
here means "gate genuinely incomplete for a partial slice," not "skipped."

**G2–G13, route coverage, permission matrix:** unchanged from #274's/#280's reasoning — no
new colour/spacing was introduced (behavior is byte-identical to the pre-move files, only
import paths changed — see Not done for the two non-relocation edits), no `check:tokens` or
visual-regression tool exists yet, Storybook adoption is still C2 (deferred, not attempted
here), no new route or screen was added, and neither `apps/api/**` nor
`packages/permissions/**` was touched.

## Checklists

### Any change

- [x] Branch named `feat/…`
- [x] Conventional commit messages
- [x] `pnpm lint` green
- [x] `pnpm typecheck` green
- [x] `pnpm test` green (`@taskdesk/ui`: 46/46, 27 files; `@taskdesk/web`: 236/236, 57 files)
- [x] No disabled or skipped tests
- [x] No new dependency
- [x] No code from an unlicensed source
- [x] Describes what changed and why, and what was left out
- [ ] **Independent review completed and recorded** — pending

### Backend change

n/a — no `apps/api/**` or `packages/permissions/**` file touched.

### Frontend change

- [x] No primitive defined outside `packages/ui` (G1) — the 7 moved primitives now live
      there; nothing new was added outside it
- [x] Tokens only (G2) — the files moved verbatim, with only import paths changed (plus
      the `Autocomplete`/`Command` package-internal import fix disclosed in Not done). A
      manual grep for literal hex/rgb/hsl/oklch across them found none (no `check:tokens`
      script exists yet; same method as #63/#274/#280).
- n/a — no new route (G5)
- n/a — no new screen/empty/loading/error state (G6)
- n/a — no axe/E2E infra exists yet (G4)
- [x] Keyboard-operable (G10) — exercised live: Escape closes Menu/ContextMenu/AlertDialog/
      Select/Command, ArrowDown highlights the next item/option in each, Enter commits a
      Select value; see `## Screens opened`
- n/a — no new animation (G9); every motion-bearing class (popup enter/exit transitions)
      is unchanged from the pre-move files
- [x] Works in light and dark — unchanged from pre-move (no CSS touched); verified visually
      in the dark-themed screenshots above
- n/a — no new layout to check at 375px/200% zoom
- n/a — no density-preference-relevant code touched
- n/a — no visual-regression tool exists (G8)
- n/a — no `size-limit`/performance-budget tool exists (G11)
- n/a — no new screen to add to the inventory
- See `## Screens opened` — opened and measured in a real browser, including keyboard
  interaction on every overlay/menu/select primitive
- **Does it look like kaneo? (H1):** yes — zero visual/behavioral change; only import paths
  (and the two mechanical fixes below) moved

### New `packages/ui` primitive

- [x] Built on Base UI (`@base-ui/react/*`) for all 7; no Radix
- [x] Variants via `cva` where the original had them (none of these 7 use `cva` except
      `select`'s `selectTriggerVariants`, unchanged from source)
- [x] Props spread, `className` accepted on all 7 (ref forwarding unchanged from
      originals — none used `React.forwardRef`, matching the existing pattern)
- [ ] Storybook story — n/a, Storybook adoption is still deferred (C2); no story convention
      exists in this repo yet
- [ ] axe clean in every story — n/a, no Storybook and no axe tooling exists
- [x] Light and dark — unchanged CSS
- [x] Reduced motion, if it animates — unchanged from pre-move (menu/select/context-menu/
      alert-dialog/command popup transitions; no new animation added)
- [x] Documented in design-system.md — all seven are already listed in its primitive
      inventory. A relocation adds no primitive and changes no design.

### New feature

n/a — no new feature; this relocates existing primitives (issue #9, P0).

### New plugin

n/a — no plugin.

### Bug fix

n/a — this isn't a bug-fix PR.

### Phase completion

n/a — #9 stays open; 17 primitives remain in `apps/web/src/components/ui/` (plus the
`error-test.tsx` harness).

## Design review H1–H6

_(Thomas only — left blank.)_

## Not done

- `autocomplete.tsx`'s `Input`/`ScrollArea` imports were repointed from `@taskdesk/ui`
  (which would have been circular from inside the package that now defines them) to the
  package-internal `./input`/`./scroll-area`, matching the pattern every other moved
  primitive already uses for its package-internal siblings (e.g. `input-group.tsx`).
- `menubar.tsx`'s `menu` import was repointed from `@/components/ui/menu` to the
  package-internal `./menu`, since `menu` moved in this same batch.
- `dialog`, `sheet` and `combobox` were considered for this batch and dropped — all three
  read `i18n` from `@/lib/i18n` for a close/remove-chip `aria-label`, which `packages/ui`
  does not depend on and this relocation-only batch may not add.
- `input-otp` was considered and dropped — it depends on the `input-otp` npm package,
  which is a dependency of `apps/web` but not of `packages/ui`; adding it would mean
  touching `packages/ui/package.json`, out of scope for a relocation-only batch (and out of
  this lane's file ownership).
- `menubar.tsx` has no importer in `apps/web` today — moved anyway as a valid,
  self-contained primitive per the extraction plan, with a colocated test but no live
  screen (same situation batch 2's/3's un-wired primitives were already in).
  `menubar.tsx`'s own classes (`flex items-center gap-1 rounded-lg border bg-background
  p-1`) are all plain utilities already generated elsewhere for other reasons, so there is
  no class unique to its source to check against the dist CSS (same situation
  `checkbox-group` was already in, in batch 3) — its correctness rests on its colocated
  test, typecheck and lint instead.
- Storybook stories were not added for any of the 7 (C2 is still not started).
- `design-system.md` was not edited — all seven primitives were already listed in its
  inventory before this batch.
- 17 primitives remain in `apps/web/src/components/ui/` for future batches (plus the
  `error-test.tsx` harness): `avatar.tsx`/`error-boundary.tsx` (still un-de-Sentry'd),
  `form.tsx`/`timeline.tsx` (still on Radix `Slot`), `breadcrumb.tsx`/`pagination.tsx`
  (still on `react-i18next`/`i18n`), `dialog.tsx`/`sheet.tsx`/`combobox.tsx` (blocked on
  that same `i18n` dependency), `input-otp.tsx` (blocked on the `input-otp` package
  dependency), and `calendar.tsx`/`loading-skeleton.tsx`/`shortcut-number.tsx`/
  `sidebar.tsx`/`toast.tsx`/`error-display.tsx`/`error-fallback.tsx` not yet assessed for a
  future batch.

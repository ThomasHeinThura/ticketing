# Motion

Adopted from kaneo's `plans/` specifications. Read them — they are in the workspace at
`../kaneo/plans/` — and treat them as the source:

| Spec | Subject |
| --- | --- |
| `001-motion-tokens-and-easing.md` | Duration and easing tokens, reduced-motion strategy |
| `002-scope-transitions.md` | Transitions between scopes: workspace, project, item |
| `003-instant-command-palette.md` | Command palette responsiveness |
| `004-press-feedback.md` | Press and tap affordances |
| `005-reduced-motion.md` | `prefers-reduced-motion` handling |
| `006-fluid-micro-moments.md` | Micro-interactions |
| `007-board-reflow.md` | Kanban card reflow on drag |

This document summarises the rules and states the ones specific to TaskDesk.

## The rule

**Motion explains a relationship. If it does not explain something, delete it.**

Good: a dialog scaling out of the button that opened it, so you know where it came from.
A card settling into a new column, so you know the drop worked. A row sliding away, so you
know it was removed rather than never having been there.

Bad: a fade because the screen looked abrupt. A bounce because it seemed fun. A staggered
list entrance on every route change, which turns a 50 ms navigation into a 400 ms one.

## Tokens

```css
--duration-instant:   0ms;
--duration-fast:    100ms;   /* hover, press, tooltip */
--duration-normal:  200ms;   /* dropdown, popover, toast */
--duration-slow:    300ms;   /* dialog, sheet, route */

--ease-out:     cubic-bezier(0.23, 1, 0.32, 1);    /* things arriving — kaneo's value, verbatim */
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1);   /* things moving — kaneo's value, verbatim */
/* kaneo defines exactly these two curves (apps/web/src/index.css). "Leaving" reverses
   --ease-out through the transition rather than adding a third curve; the drag-settle spring
   is a Framer Motion transition object in motion.ts, because spring() is not valid CSS. */
```

Arriving uses `ease-out` — fast start, gentle finish. Leaving uses `ease-in` — get out of
the way. Moving uses `ease-in-out`.

## What animates

| Interaction | Duration | Easing | Property |
| --- | --- | --- | --- |
| Hover | fast | out | background, border |
| Press | fast | out | `scale(0.98)` |
| Tooltip | fast | out | opacity, 2 px lift |
| Dropdown / popover | normal | out | opacity, `scale(0.96 → 1)` |
| Dialog | slow | out | opacity, `scale(0.96 → 1)`, backdrop fade |
| Sheet / drawer | slow | out | transform on axis |
| Toast | normal | out | slide + fade |
| Board card drop | normal | spring | transform |
| Board reflow | normal | in-out | layout (`layoutId`) |
| Row add / remove | normal | out / in | height + opacity |
| Route change | fast | out | opacity only |
| Accordion | normal | in-out | height |
| Skeleton → content | fast | out | opacity crossfade |

## What does not animate

- **Data arriving.** Numbers do not count up. Charts do not draw themselves in.
- **Route changes**, beyond a brief opacity crossfade. Navigation must feel instant.
- **Focus rings.** They appear immediately. Delaying a focus ring is an accessibility bug.
- **Anything above 300 ms.** If it feels like it needs longer, it needs rethinking.
- **Long lists.** No staggered entrance for a 200-row table.

## Reduced motion

kaneo's rule, adopted verbatim: **drop movement and container morphs, keep opacity**. A
fade that disappears is a regression for the very users the preference serves; a slide or a
re-flow that disappears is the point. kaneo does this with selectors, not by zeroing every
duration:

```css
@media (prefers-reduced-motion: reduce) {
  /* popups keep their opacity feedback, lose their movement — the data-slot list is in index.css */
  [data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="popover-content"],
  [data-slot="menu-content"], [data-slot="tooltip-content"] {
    transition-property: opacity !important;
  }
  /* containers that re-flow do not animate at all */
  [data-sidebar], [data-kaneo-sortable] { transition: none !important; }
}
```

The `!important` on `[data-kaneo-sortable]` is deliberate — dnd-kit sets inline transitions.
(The earlier block here declared custom properties outside any selector, which is invalid
CSS and did nothing; corrected 2026-09-06.)
Framer Motion uses `useReducedMotion()` to switch to instant variants.

Critically, **reduced motion removes the animation, not the affordance**. A dialog still
appears; it simply appears without scaling. Nothing becomes unusable, and nothing becomes
invisible.

Tested: a Playwright project runs the whole E2E suite with
`reducedMotion: 'reduce'` and asserts everything still works.

## Drag and drop

The one place where motion is genuinely functional rather than decorative.

- The dragged card lifts: `scale(1.02)` plus `--shadow-md`, at `--duration-fast`.
- The source position collapses; other cards reflow with `layoutId` at
  `--duration-normal`.
- A drop indicator marks the insertion point — a 2 px accent line, no animation.
- On drop, the card settles with `--ease-spring`.
- On invalid drop, it returns to origin at `--duration-normal` with `--ease-in-out`, and a
  toast explains why. Never a silent snap-back.

Under reduced motion the card jumps without the spring, and the drop indicator does all
the communicating.

## Performance

- Animate **`transform` and `opacity` only**. Anything else means layout or paint on every
  frame.
- Height animations use a measured `max-height` or Base UI's collapsible (its height is exposed through Base UI's own CSS variable, not `--radix-collapsible-content-height`), never
  `height: auto`.
- `will-change` is applied at interaction start and removed at end, never left on.
- Budget: 60 fps. A dropped frame during a board drag is a bug, and is caught by the
  performance assertion in CI.

## Loading

Skeletons, not spinners, and skeletons that match the shape of what is coming — a table
skeleton has rows, a card skeleton has a title bar and a body block. A centred spinner
tells the user nothing about what they are waiting for.

Skeletons pulse at `--duration-slow` with a shimmer. After 10 seconds a message appears
("Still loading — this is taking longer than usual") with a cancel affordance.

Spinners are reserved for **in-button pending states** on a mutation, where the shape is
already known.

## Related

- [Design tokens](design-tokens.md) · [Design principles](design-principles.md)
- [Accessibility](accessibility.md)
- kaneo's `plans/` directory

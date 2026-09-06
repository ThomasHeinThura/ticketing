# Accessibility

**Target: WCAG 2.1 Level AA.** Verified automatically in CI and manually at each phase
review.

This is not compliance theatre. A service desk is used all day, every day, by people with
varying eyesight, varying motor control, and a strong preference for not touching the
mouse. Accessibility work makes the product better for everyone who uses it heavily.

## What we get for free

Base UI handles, correctly, in every primitive (kaneo's `components/ui` is Base UI
throughout — the guarantee is attributed to the library actually in use, corrected
2026-09-06):

- Focus management and focus trapping in overlays
- Keyboard interaction patterns per WAI-ARIA authoring practices
- ARIA roles, states and relationships
- Screen reader announcements for open/close, selection, expansion
- Escape and outside-click dismissal
- Portal rendering with correct focus return

**Do not work around Base UI.** If a `Select` looks wrong, style the Base UI one
(`@base-ui/react/select`, exactly as kaneo does). Replacing it
with a `<div>` and a click handler discards all of the above and is the most common way
accessibility is lost.

## Keyboard

Every action reachable by mouse must be reachable by keyboard.

| Key | Behaviour |
| --- | --- |
| `Tab` / `Shift+Tab` | Move through focusable elements in visual order |
| `Enter` / `Space` | Activate |
| `Escape` | Close the topmost overlay; cancel an inline edit |
| `Arrow keys` | Navigate within a composite: menu, list, board, table |
| `Home` / `End` | First / last within a composite |
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Focus search |
| `?` | Keyboard shortcut reference |

Application shortcuts follow kaneo's existing set and are listed in the `?` overlay, which
is itself keyboard-navigable.

**Focus rules**

- Never `outline: none` without an equally visible replacement.
- Focus ring uses `--color-ring`, meets 3:1 against its background, and is at least 2 px.
- Focus is never trapped outside a modal context.
- Opening a dialog moves focus into it; closing returns focus to the trigger.
- A destructive dialog focuses the *cancel* action, not the destructive one.
- Route changes move focus to the page heading and announce it.

**Board drag and drop must have a keyboard path.** dnd-kit provides one: focus a card,
`Space` to lift, arrows to move, `Space` to drop, `Escape` to cancel — with live-region
announcements at each step. Verify it works; it is easy to break with custom sensors.

## Screen readers

Tested with VoiceOver (Safari, macOS) and NVDA (Firefox, Windows) at each phase review.

- Semantic HTML first. `<button>` for actions, `<a>` for navigation, real headings in
  order, real lists, real tables with `<th scope>`.
- Icon-only buttons carry an `aria-label`. Enforced by lint.
- Decorative icons carry `aria-hidden="true"`.
- Form fields have real `<label>` associations, not placeholders standing in for labels.
- Errors use `aria-invalid` and `aria-describedby` pointing at the message.
- Live regions: `aria-live="polite"` for toasts and background updates,
  `aria-live="assertive"` for errors that block progress.
- Loading states announce "Loading tickets", not silence.
- The work item key is announced as "S U P dash one two three four", not "sup1234" —
  achieved with an `aria-label` on the key element.

## Colour and contrast

- Body text ≥ 4.5:1. Large text and non-text indicators ≥ 3:1.
- **Colour is never the only signal.** SLA state carries an icon and a text label as well
  as a colour. Priority carries a shape. Required fields carry a marker and an
  `aria-required`, not just a red asterisk.
- Both themes are checked. Dark mode is where contrast most often fails.
- Automated in `scripts/check-tokens.mjs` over every declared pair.

## Motion

`prefers-reduced-motion` is honoured throughout — see [Motion](motion.md). The full E2E
suite runs a second time with reduced motion forced, asserting that everything remains
operable.

Nothing auto-plays. Nothing flashes more than three times per second.

## Forms

- Every input has a visible label. Placeholder text is never the label.
- Required fields marked visibly and programmatically.
- Errors appear next to the field, not only in a summary, and are announced.
- A submission with errors moves focus to the first invalid field.
- Field-level validation on blur; form-level on submit. Never validate on every keystroke
  — it is hostile to screen reader users.
- Destructive confirmations require typing the name of the thing, for anything
  irreversible.

## Zoom and reflow

- Usable at 200% zoom with no horizontal scrolling, per WCAG 1.4.10.
- Usable at 320 px viewport width.
- Text resizes with browser font settings — `rem` units, no `px` font sizes.
- No content is lost or non-operable at any supported size.

## Testing

| Layer | Tool | Gate |
| --- | --- | --- |
| Primitive | `vitest-axe` per Storybook story | Zero violations |
| Screen | `@axe-core/playwright` in every E2E test | Zero critical or serious |
| Keyboard | Playwright keyboard-only journeys | Core flows complete without a mouse |
| Contrast | `check-tokens.mjs` | Every declared pair passes AA |
| Reduced motion | E2E project with `reducedMotion: 'reduce'` | Full suite passes |
| Screen reader | Manual, VoiceOver + NVDA | Phase review sign-off |
| Zoom | Manual at 200% | Phase review sign-off |

Automated tooling catches roughly a third of real accessibility problems. The manual
passes at phase review are not optional.

## Known exceptions

Recorded honestly rather than hidden.

| Area | Issue | Plan |
| --- | --- | --- |
| Gantt | Complex drag interaction has no full keyboard equivalent | Provide a form-based date editor as the accessible alternative |
| Rich text editor | Tiptap's keyboard support is good but not fully AA | Track upstream; provide a plain-textarea fallback |

Any new exception requires a documented alternative path and an entry here.

## For contributors and AI agents

Before opening a pull request:

1. Tab through the whole screen. Can you reach and operate everything?
2. Is the focus ring visible at every step?
3. Do icon-only buttons have labels?
4. Are error messages associated with their fields?
5. Does it work at 200% zoom?
6. Does it work with reduced motion?
7. Did you use a Base UI primitive (through `@taskdesk/ui`) rather than a `div` with a click handler?

## Related

- [Design system](design-system.md) · [Motion](motion.md)
- [UX quality gates](ux-quality-gates.md) · [Testing strategy](../04-engineering/testing-strategy.md)

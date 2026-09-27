import { configureAxe } from "vitest-axe";

// Component tests render an isolated fragment, not a full page, so axe's
// "region" rule (all content must sit inside a landmark like <main>) does
// not apply here and would fail every single-component test.
//
// "aria-required-children" is disabled because Base UI's floating-ui-react
// portal/focus-trap machinery (used by Menu, Menubar, Popover, etc.) inserts
// its own invisible `[data-type][aria-owns]` focus-guard <span> as a direct
// child of the popup's ARIA-role container. That guard is framework focus
// plumbing, not authored content, and axe has no way to tell them apart from
// a real (invalid) child of that role.
export const axe: ReturnType<typeof configureAxe> = configureAxe({
  rules: {
    "aria-required-children": { enabled: false },
    region: { enabled: false },
  },
});

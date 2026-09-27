import { expect } from "vitest";
import { axe } from "vitest-axe";

// vitest-axe@0.1.0's own type augmentation targets a global `Vi.Assertion`
// namespace from older vitest versions, which vitest 4 no longer has (its
// `expect.extend` extension point is `@vitest/expect`'s `Matchers<T>`
// interface instead). Augment that directly rather than depend on the
// upstream package's stale types.
declare module "vitest" {
  interface Matchers<T> {
    toHaveNoViolations(): T;
  }
}

/**
 * Asserts that a rendered DOM subtree has no axe-core accessibility
 * violations. Pass `baseElement` (the default from `render()`, which is
 * `document.body`) rather than `container` for any component that portals
 * content (dialog, popover, menu, combobox, etc.) — `container` alone misses
 * portalled nodes.
 *
 * The `region` rule ("all page content should be contained by landmarks") is
 * disabled: it is a full-page layout check, and every test here renders one
 * component fragment rather than a page with header/main/footer landmarks,
 * so it would otherwise fail on every single fragment for a reason unrelated
 * to the component under test.
 */
export async function expectNoA11yViolations(root: Element): Promise<void> {
  const results = await axe(root, { rules: { region: { enabled: false } } });
  expect(results).toHaveNoViolations();
}

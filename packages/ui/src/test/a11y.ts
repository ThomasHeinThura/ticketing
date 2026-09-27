import { expect } from "vitest";
import { axe } from "vitest-axe";

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
 *
 * Asserts directly against axe's own `results.violations` array rather than
 * a custom `toHaveNoViolations()` matcher. A previous version registered
 * that matcher via a `declare module "vitest"` ambient augmentation, which
 * `scripts/ci/check-deps.mjs`'s workspace-attribution walk picked up as a
 * declaration belonging to `@taskdesk/ui`, misattributing every
 * `import ... from "vitest"` elsewhere in the workspace to this package.
 * Asserting on the plain result object needs no augmentation of a
 * third-party module's types at all.
 */
export async function expectNoA11yViolations(root: Element): Promise<void> {
  const results = await axe(root, { rules: { region: { enabled: false } } });
  expect(results.violations).toEqual([]);
}

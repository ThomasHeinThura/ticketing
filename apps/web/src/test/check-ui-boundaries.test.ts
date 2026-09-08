import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appsRoot,
  isDeepUiImport,
  isForbiddenPackageOrAppsImport,
  isRelativeEscape,
  uiSrc,
  webSrc,
} from "../../scripts/check-ui-boundaries.mjs";

// These probes exercise the *pure* predicates directly, with synthetic file paths that
// never need to exist on disk — `isRelativeEscape` / `isForbiddenPackageOrAppsImport` /
// `isDeepUiImport` only ever call `path.resolve`/`path.relative` on the strings they are
// given, they never touch the filesystem. Each probe below also runs the OLD, string-prefix
// predicate inline (copied from the pre-fix implementation) as its own non-vacuity
// control: a probe whose bypass case the old code also rejected proves nothing about the
// fix, so every RED/GREEN pair below shows the old predicate's answer too.

/** The pre-fix Rule 1 escape test: a plain string-prefix check. */
function oldIsRelativeEscape(file: string, spec: string): boolean {
  const uiSrcNormalized = uiSrc.replace(/\\/g, "/");
  return (
    spec.startsWith(".") &&
    !path
      .resolve(path.dirname(file), spec)
      .replace(/\\/g, "/")
      .startsWith(uiSrcNormalized)
  );
}

/** The pre-fix Rule 1 forbidden-bare-specifier test: textual "/apps/" / "apps/" matching. */
function oldIsForbiddenBareSpecifier(spec: string): boolean {
  return (
    spec === "@taskdesk/permissions" ||
    spec.startsWith("@taskdesk/permissions/") ||
    spec === "@taskdesk/api" ||
    spec.startsWith("@taskdesk/api/") ||
    spec.includes("/apps/") ||
    spec.startsWith("apps/")
  );
}

/** The pre-fix Rule 2 deep-import test: a plain string-prefix check. */
function oldIsDeepImport(file: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(file), spec).replace(/\\/g, "/");
  return resolved.startsWith(uiSrc.replace(/\\/g, "/"));
}

describe("check-ui-boundaries containment predicates", () => {
  it("flags a relative import that escapes packages/ui/src into a sibling directory whose name has 'src' as a prefix (false negative in the old string-prefix check)", () => {
    const file = path.join(uiSrc, "components", "button.tsx");
    const spec = "../../src-legacy/evil.ts"; // resolves to packages/ui/src-legacy/evil.ts

    // Non-vacuity control: the OLD predicate must actually accept this bypass, or the
    // probe proves nothing about the fix.
    expect(oldIsRelativeEscape(file, spec)).toBe(false); // RED: old code missed the escape

    expect(isRelativeEscape(file, spec)).toBe(true); // GREEN: new code catches it
  });

  it("does not flag an apps/web relative import into a sibling directory whose name has 'src' as a prefix (false positive in the old string-prefix check)", () => {
    const file = path.join(webSrc, "components", "widget.tsx");
    const spec = "../../../../packages/ui/src-legacy/thing.ts"; // resolves to packages/ui/src-legacy/thing.ts, NOT packages/ui/src

    // Non-vacuity control: the OLD predicate must actually reject (flag) this legitimate
    // import, or the probe proves nothing about the fix.
    expect(oldIsDeepImport(file, spec)).toBe(true); // RED: old code wrongly flagged it

    expect(isDeepUiImport(file, spec)).toBe(false); // GREEN: new code correctly clears it
  });

  it("flags a relative specifier that resolves into apps/** without textually containing '/apps/' (a specifier ending exactly in 'apps', no trailing slash)", () => {
    const file = path.join(uiSrc, "a", "b", "c.tsx");
    const spec = "../../../../../apps"; // resolves exactly to <repoRoot>/apps
    const resolved = path.resolve(path.dirname(file), spec);
    expect(resolved).toBe(appsRoot); // sanity: this genuinely reaches apps/**

    // Non-vacuity control: the OLD textual predicate must actually accept this bypass.
    // Neither "/apps/" (no trailing slash here) nor "apps/" (the specifier starts with
    // ".." not "apps") matches — that is exactly the gap.
    expect(oldIsForbiddenBareSpecifier(spec)).toBe(false); // RED: old code missed it

    expect(isForbiddenPackageOrAppsImport(file, spec)).toBe(true); // GREEN: new code catches it
  });

  it("does not flag a textual near-miss bare specifier that merely contains 'apps' as a substring (the false-positive direction)", () => {
    const file = path.join(uiSrc, "components", "button.tsx");
    const spec = "@scope/apps-something"; // a real, unrelated package name

    expect(oldIsForbiddenBareSpecifier(spec)).toBe(false);
    expect(isForbiddenPackageOrAppsImport(file, spec)).toBe(false); // stays green under both
  });

  it("leaves an ordinary legitimate import green: apps/web consuming @taskdesk/ui by its package specifier", () => {
    const file = path.join(webSrc, "components", "widget.tsx");
    const spec = "@taskdesk/ui";

    expect(oldIsDeepImport(file, spec)).toBe(false);
    expect(isDeepUiImport(file, spec)).toBe(false); // stays green under both
  });

  it("still flags a genuine deep relative import into packages/ui/src (regression guard for the fix)", () => {
    const file = path.join(webSrc, "components", "widget.tsx");
    const spec = "../../../../packages/ui/src/components/button.tsx";

    expect(oldIsDeepImport(file, spec)).toBe(true);
    expect(isDeepUiImport(file, spec)).toBe(true); // still caught after the fix
  });

  it("still flags a genuine forbidden import from packages/ui into apps/** whose specifier textually contains '/apps/' (regression guard for the fix)", () => {
    const file = path.join(uiSrc, "widgets", "thing.tsx");
    const spec = "../../../../apps/web/src/x";

    expect(oldIsForbiddenBareSpecifier(spec)).toBe(true);
    expect(isForbiddenPackageOrAppsImport(file, spec)).toBe(true); // still caught after the fix
  });

  it("treats an import resolving to the packages/ui/src root itself as a deep import, not an excluded edge case", () => {
    const file = path.join(webSrc, "components", "widget.tsx");
    const spec = "../../../../packages/ui/src"; // resolves exactly to uiSrc, no subpath

    expect(isDeepUiImport(file, spec)).toBe(true);
  });
});

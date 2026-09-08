#!/usr/bin/env node
// C1 (issue #9) boundary guard — no external tool exists yet for this (check:deps /
// check:ui are "not yet", per AGENTS.md's command table), so this is the check itself,
// wired into `apps/web`'s own `lint` script (turbo `lint` therefore exercises it on every
// `pnpm lint`). It enforces two of the three import-boundary rules from
// docs/02-design/ui-extraction-plan.md and the monorepo-layout.md package-boundary table:
//
//   - packages/ui may not import from apps/** or from packages/permissions or
//     apps/api (monorepo-layout.md: "packages/ui may not import from apps/* or from
//     any feature package").
//   - apps/web must consume the extracted primitives via `@taskdesk/ui`, never by a
//     deep relative import that reaches into packages/ui/src directly.
//
// (The third rule — no import of packages/ui from apps/api or packages/permissions
// themselves — is structurally impossible today: neither of those packages lists
// @taskdesk/ui as a dependency, so nothing in this repo can import it from there.)
//
// This is intentionally a small, dependency-free static scan (regex over import/export
// specifiers), not a full module-graph tool like dependency-cruiser — adding
// dependency-cruiser is an external dependency, which is out of scope for C1.
//
// Every question below is a *containment* question — "does this resolved path live
// inside that directory" — and every one of them is answered by resolving the specifier
// to a real filesystem path and testing it with `path.relative`, never by comparing
// strings with `startsWith`/`includes`. A string prefix is not path containment:
// `packages/ui/src` is a *string* prefix of `packages/ui/src-legacy`, `packages/ui/srcx`
// and `packages/ui/src.bak`, none of which is inside `packages/ui/src`. The pure
// predicates below are exported so a test can exercise them directly, without shelling
// out to this file or relying on the real tree containing a bypass to prove a fix.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../../..");
export const webSrc = path.resolve(__dirname, "../src");
export const uiSrc = path.resolve(repoRoot, "packages/ui/src");
export const appsRoot = path.resolve(repoRoot, "apps");

/**
 * Genuine path-relative containment: is `target` inside `base`, or `base` itself?
 *
 * `path.relative(base, target)` is ".." or starts with ".." exactly when `target` falls
 * outside `base`, regardless of how the two strings happen to overlap textually — unlike
 * `target.startsWith(base)`, which a sibling directory sharing a name prefix (`src` /
 * `src-legacy`) satisfies by accident.
 *
 * `target === base` (`rel === ""`) is deliberately treated as INSIDE, not excluded. Every
 * containment question this file asks — did a relative import escape packages/ui/src,
 * does an apps/web import reach into packages/ui/src, does a packages/ui import reach
 * into apps/** — is still true when the resolved target IS the boundary directory's own
 * root: module resolution would still read a file under that root (its index), so
 * `import x from "../../../packages/ui/src"` with no further path is exactly as much a
 * deep import into packages/ui/src as one that names a file inside it. Excluding `rel ===
 * ""` would silently open the one bypass of importing the barrel instead of a named file.
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
export function isWithin(base, target) {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a relative import specifier against the file that contains it. Returns `null`
 * for a bare/package specifier — there is nothing on disk to test containment against.
 * @param {string} file
 * @param {string} spec
 * @returns {string | null}
 */
export function resolveRelativeSpecifier(file, spec) {
  if (!spec.startsWith(".")) return null;
  return path.resolve(path.dirname(file), spec);
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    // Decide deliberately what a symlink does here, rather than let an implicit
    // follow-and-forget answer the containment question by accident: a symlink inside
    // the scanned tree that points outside it (e.g. `packages/ui/src/escape ->
    // ../../../apps`) would let this walk step straight out of the tree it is supposed
    // to be bounded by, and scan (or skip scanning) files whose real location this scan
    // never actually verified. Use `lstatSync`, not `statSync`, and skip symlinks
    // entirely — this scan only ever reports on real files physically inside the
    // directory it was asked to walk.
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * @param {string} file
 * @returns {string[]}
 */
export function specifiers(file) {
  const src = readFileSync(file, "utf8");
  const found = [];
  for (const m of src.matchAll(IMPORT_SPECIFIER)) {
    found.push(m[1]);
  }
  return found;
}

/**
 * Rule 1a: a relative import inside packages/ui must not resolve outside packages/ui/src.
 * @param {string} file
 * @param {string} spec
 * @returns {boolean}
 */
export function isRelativeEscape(file, spec) {
  const resolved = resolveRelativeSpecifier(file, spec);
  if (resolved === null) return false;
  return !isWithin(uiSrc, resolved);
}

/**
 * Rule 1b: packages/ui may not import packages/permissions or apps/api by workspace
 * package name, and may not import anything under apps/** by resolved filesystem
 * location.
 *
 * There is no tsconfig `paths` alias and no workspace package named "apps" anywhere in
 * this repo (checked against every `paths` table and pnpm-workspace.yaml), so the only
 * way a specifier can actually reach apps/** is a relative import that resolves there —
 * decided here by resolving and testing containment, never by matching "/apps/" as text.
 * A text match misses a specifier that ends exactly in "apps" with no trailing slash
 * (resolving to the app's own index, exactly as much a violation as naming a file inside
 * it), and would wrongly match an unrelated bare specifier like "@scope/apps-something"
 * if this check were ever extended to non-relative specifiers.
 * @param {string} file
 * @param {string} spec
 * @returns {boolean}
 */
export function isForbiddenPackageOrAppsImport(file, spec) {
  if (
    spec === "@taskdesk/permissions" ||
    spec.startsWith("@taskdesk/permissions/") ||
    spec === "@taskdesk/api" ||
    spec.startsWith("@taskdesk/api/")
  ) {
    return true;
  }
  const resolved = resolveRelativeSpecifier(file, spec);
  if (resolved === null) return false;
  return isWithin(appsRoot, resolved);
}

/**
 * Rule 2: apps/web must consume primitives via `@taskdesk/ui`, never a deep relative
 * import that reaches into packages/ui/src directly.
 * @param {string} file
 * @param {string} spec
 * @returns {boolean}
 */
export function isDeepUiImport(file, spec) {
  const resolved = resolveRelativeSpecifier(file, spec);
  if (resolved === null) return false;
  return isWithin(uiSrc, resolved);
}

/**
 * @returns {{ violations: string[], uiFileCount: number, webFileCount: number }}
 */
export function collectViolations() {
  const violations = [];

  const uiFiles = walk(uiSrc);
  for (const file of uiFiles) {
    for (const spec of specifiers(file)) {
      if (isForbiddenPackageOrAppsImport(file, spec)) {
        violations.push(
          `packages/ui: ${path.relative(repoRoot, file)} imports "${spec}" — packages/ui may not import from apps/** or from packages/permissions/apps/api (docs/01-architecture/monorepo-layout.md#package-boundaries).`,
        );
      } else if (isRelativeEscape(file, spec)) {
        violations.push(
          `packages/ui: ${path.relative(repoRoot, file)} imports "${spec}" — this relative import resolves outside packages/ui/src (docs/01-architecture/monorepo-layout.md#package-boundaries).`,
        );
      }
    }
  }

  const webFiles = walk(webSrc);
  for (const file of webFiles) {
    for (const spec of specifiers(file)) {
      if (isDeepUiImport(file, spec)) {
        violations.push(
          `apps/web: ${path.relative(repoRoot, file)} imports "${spec}" — a deep relative import into packages/ui/src. Import from "@taskdesk/ui" instead (docs/02-design/ui-extraction-plan.md).`,
        );
      }
    }
  }

  return {
    violations,
    uiFileCount: uiFiles.length,
    webFileCount: webFiles.length,
  };
}

function main() {
  const { violations, uiFileCount, webFileCount } = collectViolations();

  if (violations.length > 0) {
    console.error("check-ui-boundaries: FAILED\n");
    for (const v of violations) console.error(`  - ${v}`);
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    `check-ui-boundaries: OK (${uiFileCount} packages/ui files, ${webFileCount} apps/web files scanned)`,
  );
}

// Only run the CLI when this file is executed directly (`node scripts/check-ui-boundaries.mjs`),
// not when a test imports it for its pure predicate functions.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}

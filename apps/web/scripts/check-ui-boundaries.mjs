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

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const webSrc = path.resolve(__dirname, "../src");
const uiSrc = path.resolve(repoRoot, "packages/ui/src");

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** @param {string} file @returns {string[]} */
function specifiers(file) {
  const src = readFileSync(file, "utf8");
  const found = [];
  for (const m of src.matchAll(IMPORT_SPECIFIER)) {
    found.push(m[1]);
  }
  return found;
}

const violations = [];

// Rule 1: packages/ui must not import from apps/** (or packages/permissions, apps/api
// by name — belt-and-suspenders alongside the missing-workspace-dependency check that
// typecheck already performs for those two).
const uiSrcNormalized = uiSrc.replace(/\\/g, "/");
for (const file of walk(uiSrc)) {
  for (const spec of specifiers(file)) {
    const isRelativeEscape =
      spec.startsWith(".") &&
      !path
        .resolve(path.dirname(file), spec)
        .replace(/\\/g, "/")
        .startsWith(uiSrcNormalized);
    const isForbiddenBareSpecifier =
      spec === "@taskdesk/permissions" ||
      spec.startsWith("@taskdesk/permissions/") ||
      spec === "@taskdesk/api" ||
      spec.startsWith("@taskdesk/api/") ||
      spec.includes("/apps/") ||
      spec.startsWith("apps/");
    if (isRelativeEscape || isForbiddenBareSpecifier) {
      violations.push(
        `packages/ui: ${path.relative(repoRoot, file)} imports "${spec}" — packages/ui may not import from apps/** or from packages/permissions/apps/api (docs/01-architecture/monorepo-layout.md#package-boundaries).`,
      );
    }
  }
}

// Rule 2: apps/web must consume the extracted primitives via `@taskdesk/ui`, never a
// deep relative import into packages/ui/src.
for (const file of walk(webSrc)) {
  for (const spec of specifiers(file)) {
    if (!spec.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(file), spec).replace(/\\/g, "/");
    if (resolved.startsWith(uiSrc.replace(/\\/g, "/"))) {
      violations.push(
        `apps/web: ${path.relative(repoRoot, file)} imports "${spec}" — a deep relative import into packages/ui/src. Import from "@taskdesk/ui" instead (docs/02-design/ui-extraction-plan.md).`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("check-ui-boundaries: FAILED\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log(
  `check-ui-boundaries: OK (${walk(uiSrc).length} packages/ui files, ${walk(webSrc).length} apps/web files scanned)`,
);

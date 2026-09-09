import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #59: `pnpm build` exits 0, but `node apps/api/dist/index.js` fails with
 * `ERR_MODULE_NOT_FOUND` on `packages/permissions/dist/better-auth-plugins`, because `tsc`
 * emits relative specifiers exactly as written in `src/` — an extensionless `"./policy"` in
 * source becomes an extensionless `"./policy"` in `dist/policy.js`, and Node's ESM resolver
 * (unlike a bundler) refuses to guess the extension at runtime.
 *
 * `build exit 0` is not evidence this cannot regress: `tsc` happily emits an unresolvable
 * specifier without complaint under `"moduleResolution": "bundler"`. The only durable guard
 * is one that reads the actual built output, so this test does — it is a **behavioural**
 * assertion (this package's shipped ESM boots under Node), not a lint rule, and it is not
 * satisfied by `strict` mode, `tsc` exiting 0, or `pnpm test` alone.
 *
 * It fails loudly rather than passing vacuously when `dist/` is missing or empty — run
 * `pnpm --filter @taskdesk/permissions build` first — because a guard that can silently pass
 * over "nothing to check" is no guard at all.
 */

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

function collectDistJsFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `packages/permissions/dist does not exist at "${dir}". Run ` +
        "`pnpm --filter @taskdesk/permissions build` before running this test. " +
        `(${(error as Error).message})`,
    );
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDistJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Every `import ... from "…"`, `export ... from "…"`, bare `import "…"` and dynamic
 * `import("…")` specifier in an emitted `.js` file. Deliberately broader than what today's
 * `tsc` output happens to use, so a future emit style (e.g. a bare side-effecting import)
 * is still covered.
 */
const SPECIFIER_PATTERN =
  /\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|(?:^|[;{}]\s*)import\s+["']([^"']+)["']/gm;

const HAS_EXPLICIT_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

describe("dist ESM specifiers carry explicit extensions (#59)", () => {
  it("has built output to check — a guard that finds nothing checks nothing", () => {
    const files = collectDistJsFiles(DIST_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it("every relative specifier in dist/**/*.js carries an explicit extension", () => {
    const files = collectDistJsFiles(DIST_DIR);
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(SPECIFIER_PATTERN)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (!specifier) continue;
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          // Bare package specifiers (e.g. "better-auth/plugins/access") are Node's problem
          // to resolve via node_modules, not ours — this guard is only about the relative
          // specifiers this package's own build emits.
          continue;
        }
        if (!HAS_EXPLICIT_EXTENSION.test(specifier)) {
          offenders.push(`${file}: "${specifier}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

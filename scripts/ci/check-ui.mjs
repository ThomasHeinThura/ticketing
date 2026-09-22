#!/usr/bin/env node
/**
 * check:ui — the Radix-dependency tracking half of gate G1.
 *
 * docs/04-engineering/ci-cd.md's G1 is "no bespoke primitives; no Radix/Base UI import
 * outside packages/ui; Radix only per KNOWN-RADIX.md". `packages/ui` has 18 of 63 primitives
 * moved so far (#9); "no bespoke primitives" and "no Radix/Base UI import outside
 * packages/ui" have nothing to be true of yet — the other 44 files under
 * `apps/web/src/components/ui/` are still legitimately there. **This script checks only the
 * Radix-tracking half**, which is already fully true today: every real `@radix-ui/*` /
 * `radix-ui` import in the repository was removed in the same change that added this script
 * (#9 — `apps/web/src/components/ui/form.tsx` and `timeline.tsx` both moved to a local
 * `Slot` in `apps/web/src/lib/slot.tsx`). The other two clauses of G1 are for whichever
 * later #9 slice finishes moving the remaining primitives and empties
 * `apps/web/src/components/ui`.
 *
 * The rule this enforces: any file that imports `@radix-ui/*` or the bare `radix-ui`
 * umbrella package must be listed in the fixed-column table at the top level
 * `KNOWN-RADIX.md`, naming the exact file and package. A file importing an unlisted
 * package is a HARD FAILURE (an unreviewed Radix dependency crept back in); a table row
 * naming a file/package pair that no longer imports it is also a HARD FAILURE (a stale
 * entry — the table is meant to stay at its true minimum, not accumulate history).
 *
 * KNOWN-RADIX.md's table is deliberately small and fixed-shape: a GFM table with exactly
 * the header `| File | Package | Reason |`, its separator row, and zero or more data rows.
 * Anything else — a missing/renamed column, a malformed row — is a HARD FAILURE rather
 * than a silent partial parse; a tracking file this cannot read is not a tracking file
 * with nothing in it.
 *
 * Usage:
 *   node scripts/ci/check-ui.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  finish,
  isCode,
  readText,
  rel,
  repoRoot,
  violation,
  walk,
} from "./lib/repo.mjs";

const NAME = "check:ui";
export const KNOWN_RADIX_RELATIVE_PATH = "KNOWN-RADIX.md";

const EXPECTED_HEADER_CELLS = ["File", "Package", "Reason"];

/**
 * Every `import ... from "<spec>"`, `export ... from "<spec>"`, `import "<spec>"`
 * (side-effect-only), `import("<spec>")` or `require("<spec>")` module specifier in a
 * source file — not a full parser, just the shapes this codebase's `import`/`require`
 * statements actually take. Deliberately anchored to the `from`/`import`/`require` keyword
 * immediately before the quoted string, so a comment or doc string that merely *mentions* a
 * package name (this file's own header above does) is never mistaken for an import.
 */
const IMPORT_SPECIFIER =
  /\b(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;

/**
 * True for `@radix-ui/<anything>`, the bare `radix-ui` umbrella package, or any
 * `radix-ui/<subpath>` of it (`radix-ui@1.6.7` ships a `"./*"` wildcard export map, so
 * `radix-ui/slot` etc. are real, resolvable imports of the umbrella package and must be
 * caught the same way as the scoped `@radix-ui/*` case already is).
 */
function isRadixSpecifier(specifier) {
  return (
    specifier === "radix-ui" ||
    specifier.startsWith("radix-ui/") ||
    specifier.startsWith("@radix-ui/")
  );
}

/** Every Radix/radix-ui module specifier imported anywhere in the given source text. */
export function radixImportsIn(source) {
  const found = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    if (isRadixSpecifier(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * Parse `KNOWN-RADIX.md`'s tracking table into `{ file, pkg, reason }` rows.
 *
 * Locates the first contiguous block of `|`-delimited lines, requires its header cells to
 * be exactly `File`, `Package`, `Reason` (in that order) and its second line to be a GFM
 * separator row, then reads every following `|`-delimited line as a data row until the
 * block ends. Throws — rather than returning a partial result — when no such table is
 * found, the header does not match, or a data row does not have exactly three cells.
 *
 * @param {string} source the raw contents of KNOWN-RADIX.md
 * @returns {{ file: string, pkg: string, reason: string }[]}
 */
export function parseKnownRadixTable(source) {
  const lines = source.split("\n");
  const tableLines = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.startsWith("|") && line.endsWith("|"));

  if (tableLines.length < 2) {
    throw new Error(
      `${KNOWN_RADIX_RELATIVE_PATH} contains no GFM table (a header row, a separator row, ` +
        "and zero or more data rows, every line starting and ending with `|`). This gate " +
        "parses that table to know which files may import Radix — a file it cannot find is " +
        "not a table with nothing in it.",
    );
  }

  const cellsOf = (line) =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

  const header = cellsOf(tableLines[0].line);
  if (
    header.length !== EXPECTED_HEADER_CELLS.length ||
    !header.every((cell, i) => cell === EXPECTED_HEADER_CELLS[i])
  ) {
    throw new Error(
      `${KNOWN_RADIX_RELATIVE_PATH}'s table header is \`| ${header.join(" | ")} |\`, not the ` +
        `fixed \`| ${EXPECTED_HEADER_CELLS.join(" | ")} |\` this gate parses. The column set ` +
        "is fixed on purpose (this gate matches by position) — rename it back, or update " +
        "this script's EXPECTED_HEADER_CELLS in the same change as a deliberate schema change.",
    );
  }

  const separator = cellsOf(tableLines[1].line);
  if (
    separator.length !== EXPECTED_HEADER_CELLS.length ||
    !separator.every((cell) => /^:?-+:?$/.test(cell))
  ) {
    throw new Error(
      `${KNOWN_RADIX_RELATIVE_PATH}'s second table line is not a GFM separator row ` +
        "(`| --- | --- | --- |`). A table this cannot recognize as well-formed is not a " +
        "table with nothing in it.",
    );
  }

  const rows = [];
  for (const { line, index } of tableLines.slice(2)) {
    const cells = cellsOf(line);
    if (cells.length !== EXPECTED_HEADER_CELLS.length) {
      throw new Error(
        `${KNOWN_RADIX_RELATIVE_PATH}:${index + 1} has ${cells.length} cell(s), not the ` +
          `${EXPECTED_HEADER_CELLS.length} the fixed column set requires: \`${line}\`.`,
      );
    }
    const [file, pkg, reason] = cells;
    if (file === "" || pkg === "") {
      throw new Error(
        `${KNOWN_RADIX_RELATIVE_PATH}:${index + 1} has an empty File or Package cell: ` +
          `\`${line}\`. Every row must name an exact file and an exact package.`,
      );
    }
    rows.push({ file, pkg, reason });
  }

  return rows;
}

async function main() {
  const failures = [];
  const knownRadixPath = path.join(repoRoot, KNOWN_RADIX_RELATIVE_PATH);

  let knownSource;
  try {
    knownSource = await readText(knownRadixPath);
  } catch (error) {
    finish({
      name: NAME,
      failures: [
        violation(
          KNOWN_RADIX_RELATIVE_PATH,
          `could not be read (${error.code ?? error.message}). This gate has nothing to ` +
            "check Radix imports against without it.",
        ),
      ],
    });
    return;
  }

  let knownRows;
  try {
    knownRows = parseKnownRadixTable(knownSource);
  } catch (error) {
    finish({
      name: NAME,
      failures: [violation(KNOWN_RADIX_RELATIVE_PATH, error.message)],
    });
    return;
  }

  // "file\npkg" -> row, for stale-entry detection. A newline is safe as a
  // composite-key separator here (neither a relative file path nor an npm
  // package name can contain one), unlike a null byte, which is technically
  // just as unambiguous but makes the whole file read as binary to
  // `git diff`/`file` and any future diff on this file unreviewable.
  const known = new Map();
  for (const row of knownRows) {
    known.set(`${row.file}\n${row.pkg}`, row);
  }
  const matchedKnownKeys = new Set();

  const files = await walk(repoRoot, isCode);
  for (const absolute of files) {
    const relative = rel(absolute);
    // This script itself legitimately names Radix packages in prose/regex source, not in
    // import syntax — IMPORT_SPECIFIER already excludes prose, this is just the
    // (redundant, cheap) belt-and-braces skip.
    if (relative === "scripts/ci/check-ui.mjs") continue;
    // check-ui.test.mjs builds fixture strings containing literal `from "@radix-ui/..."`
    // / `import "radix-ui"` TEXT to unit-test radixImportsIn() itself (the same pattern
    // check-dockerfile-deps.test.mjs uses for Dockerfile fixtures) — those are test DATA,
    // not real imports, and this scanner has no way to tell "a string literal containing
    // import-shaped text" apart from "a real import" by reading raw source, so the file
    // that is knowingly full of such fixtures is excluded rather than mis-flagged.
    if (relative === "scripts/ci/check-ui.test.mjs") continue;

    const source = await readText(absolute);
    for (const pkg of radixImportsIn(source)) {
      const key = `${relative}\n${pkg}`;
      if (known.has(key)) {
        matchedKnownKeys.add(key);
        continue;
      }
      failures.push(
        violation(
          relative,
          `imports \`${pkg}\`, which is not listed in ${KNOWN_RADIX_RELATIVE_PATH}. Either ` +
            "replace it with a Base UI equivalent or a small local implementation the way " +
            "#9 did for `Slot` (apps/web/src/lib/slot.tsx), or add a row to " +
            `${KNOWN_RADIX_RELATIVE_PATH} naming exactly this file, this package, and why.`,
        ),
      );
    }
  }

  for (const [key, row] of known) {
    if (matchedKnownKeys.has(key)) continue;
    failures.push(
      violation(
        KNOWN_RADIX_RELATIVE_PATH,
        `lists \`${row.file}\` importing \`${row.pkg}\`, but that file no longer imports ` +
          "that package (or no longer exists). Remove the stale row — the table is meant " +
          "to stay at its true minimum.",
      ),
    );
  }

  finish({
    name: NAME,
    failures,
    ok: `0 unlisted Radix import(s), ${knownRows.length} tracked row(s), all current.`,
  });
}

// Only run when invoked directly — never as a side effect of a test file importing
// `radixImportsIn` / `parseKnownRadixTable` for unit testing against fixture strings.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}

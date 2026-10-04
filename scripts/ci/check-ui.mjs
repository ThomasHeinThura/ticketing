#!/usr/bin/env node
/**
 * check:ui — G1b Radix import tracking and G1c empty-directory enforcement.
 *
 * G1c asserts that `apps/web/src/components/ui` is empty after extraction. G1b keeps every
 * live Radix import registered in KNOWN-RADIX.md and rejects new/untracked usage. G1a raw
 * element enforcement remains a separate check; this script does not claim to implement it.
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
 * **Import detection is a real parser, not a regex (issue #255).** Round 2 of #253's Opus
 * review found three resolvable evasions of the regex this used to use, all in the same
 * class as check-deps.mjs's own earlier fix (see that file's header and
 * docs/04-engineering/error-fix-loop.md): a Unicode escape inside the quoted specifier
 * (the regex saw the literal backslash-u source text, not the decoded string), a comment
 * between the `from`/`import` keyword and the quoted string (the regex's keyword anchor
 * doesn't skip trivia), and a template-literal dynamic import with no substitution
 * (`import(\`radix-ui/slot\`)`, a syntax shape the regex's `["']` alternation never
 * matched at all). check-deps.mjs already established the pattern for this exact class in
 * this repo — parse with `typescript/unstable/ast` via `typescript/unstable/sync`'s `API`
 * and read the parser's own decoded literal text — and this file now follows it. Every one
 * of the three findings, and the general class behind them (any escape form, any trivia
 * placement, any no-substitution template literal), closes for free: `moduleSpecifiersIn`
 * only ever looks at specific AST node shapes (an ImportDeclaration's moduleSpecifier, a
 * dynamic import()/require() call's first argument, …) and reads each one's already-parsed
 * `.text`, so there is no raw source text left for an evasion to hide in. See
 * `moduleSpecifiersIn`'s own comment for the one limit this still has, which is not new.
 *
 * Usage:
 *   node scripts/ci/check-ui.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
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

/** The decoded string value of a specifier node, or undefined when it is not a plain
 * string/no-substitution-template literal. Reading the parser's own `.text` — rather than
 * slicing the raw source the way a regex would — is what closes the escape-sequence
 * evasion (#255 finding 1): the parser has already turned `"\u{72}adix-ui/slot"` into the
 * real string `radix-ui/slot` by the time this reads it, the same as the JS engine does at
 * runtime, instead of comparing the literal backslash-u source text.
 */
function literalSpecifierText(node) {
  if (!node) return undefined;
  return node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ? node.text
    : undefined;
}

/**
 * Every statically-determinable module specifier a source file's real import/export/
 * require syntax resolves to, as `{ specifier, line }`, in document order.
 *
 * Walking the parsed AST rather than matching source text is what closes #255's other two
 * evasions: a comment between the `from`/`import` keyword and the quoted string is trivia
 * the grammar already skips no matter where it sits (finding 2), and a template-literal
 * dynamic import with no substitution (finding 3) parses to a NoSubstitutionTemplateLiteral
 * node, handled by `literalSpecifierText` exactly like an ordinary string literal.
 *
 * Accepted limit, unchanged from the regex this replaces and the same class check-deps.mjs
 * already documents for itself: a specifier built from anything other than a plain string
 * or no-substitution-template literal — a variable, a template literal WITH a substitution,
 * string concatenation — cannot be resolved to a specifier at all. An import genuinely
 * computed at runtime was never caught by the old regex either, and still isn't; it also
 * still cannot be proven to be a Radix package unless the file's own literal text says so.
 */
export function moduleSpecifiersIn(sourceFile) {
  const found = [];
  const add = (node) => {
    const specifier = literalSpecifierText(node);
    if (specifier === undefined) return;
    found.push({
      specifier,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
    });
  };

  function visit(node) {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
      case ts.SyntaxKind.ExportDeclaration:
        if (node.moduleSpecifier) add(node.moduleSpecifier);
        break;
      case ts.SyntaxKind.ImportEqualsDeclaration:
        if (
          node.moduleReference?.kind === ts.SyntaxKind.ExternalModuleReference
        ) {
          add(node.moduleReference.expression);
        }
        break;
      case ts.SyntaxKind.ImportType:
        // Type-position `import(...)` — `export type Y = import("radix-ui").X` and the
        // JSDoc `@typedef {import("radix-ui").X}` form both parse to this node.
        if (node.argument?.kind === ts.SyntaxKind.LiteralType) {
          add(node.argument.literal);
        }
        break;
      case ts.SyntaxKind.CallExpression: {
        const callee = node.expression;
        const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
        // Opus review (#413 F1): a bare `require("x")` and a member-call form like
        // `module.require("x")` are both real at runtime in CommonJS. The old regex
        // caught the member-call form (`\brequire\s*\(` doesn't care what precedes it);
        // matching only a bare `Identifier` callee here was a real regression against it.
        // `(require)("x")` and a renamed import (`createRequire(...)("x")`) stay INSIDE
        // the documented accepted limit (i.e. still uncaught misses), same as before
        // this fix.
        const isRequire =
          (callee.kind === ts.SyntaxKind.Identifier &&
            callee.text === "require") ||
          (callee.kind === ts.SyntaxKind.PropertyAccessExpression &&
            callee.name.text === "require");
        if (isDynamicImport || isRequire) add(node.arguments[0]);
        break;
      }
      default:
        break;
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return found;
}

/**
 * Parse a raw source string into a real TypeScript AST, for `radixImportsIn`'s unit tests
 * only — `main()` below never calls this. The API this gate is built on
 * (`typescript/unstable/sync`) parses files on disk, not in-memory strings, and a unit
 * test's fixture is a string; a fresh scratch directory and a short-lived API instance per
 * call give it a real file to parse without leaving anything behind or touching the real
 * repository tree. `main()` instead opens every real file in one batch (see below) — one
 * spawned parser process for the whole repo scan, not one per file.
 */
function parseAdHoc(source) {
  const dir = mkdtempSync(path.join(tmpdir(), "check-ui-scratch-"));
  try {
    const file = path.join(dir, "fixture.ts");
    writeFileSync(file, source);
    const api = new API({ cwd: dir });
    try {
      const snapshot = api.updateSnapshot({ openFiles: [file] });
      try {
        const project = snapshot.getDefaultProjectForFile(file);
        const sourceFile = project?.program.getSourceFile(file);
        if (!sourceFile) {
          throw new Error(`could not parse fixture source (${file})`);
        }
        return moduleSpecifiersIn(sourceFile);
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every Radix/radix-ui module specifier imported anywhere in the given source text. */
export function radixImportsIn(source) {
  return parseAdHoc(source)
    .map(({ specifier }) => specifier)
    .filter(isRadixSpecifier);
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
  const legacyUiDirectory = path.join(repoRoot, "apps/web/src/components/ui");

  try {
    const entries = await readdir(legacyUiDirectory);
    if (entries.length > 0) {
      failures.push(
        violation(
          "apps/web/src/components/ui",
          `must be empty after extraction; found ${entries.length} entr${entries.length === 1 ? "y" : "ies"}. Move app compositions to apps/web and shared primitives to packages/ui.`,
        ),
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      failures.push(
        violation(
          "apps/web/src/components/ui",
          `could not inspect the legacy directory (${error.code ?? error.message}).`,
        ),
      );
    }
  }

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

  // One parser process for the whole repo scan (batched — see moduleSpecifiersIn's and
  // parseAdHoc's comments for why this is not per-file), opening every candidate file at
  // once. Real AST parsing means neither of the two special-cased exclusions this loop
  // used to need (for this file's own header prose, and for check-ui.test.mjs's fixture
  // strings) is necessary any more: a fixture like `'import { Slot } from "@radix-ui/..."'`
  // in a test file is one JS string literal to a real parser, not an ImportDeclaration —
  // there is no import syntax for it to be mistaken for, so both files are scanned like
  // any other and simply find nothing (they contain zero real Radix imports).
  const api = new API({ cwd: repoRoot });
  try {
    const snapshot = api.updateSnapshot({ openFiles: files });
    try {
      for (const absolute of files) {
        const relative = rel(absolute);
        const project = snapshot.getDefaultProjectForFile(absolute);
        const sourceFile = project?.program.getSourceFile(absolute);
        const diagnostics = sourceFile
          ? project.program.getSyntacticDiagnostics(absolute)
          : [];
        if (!sourceFile || diagnostics.length > 0) {
          failures.push(
            violation(
              relative,
              "could not be parsed" +
                (diagnostics.length > 0
                  ? ` (${diagnostics.map((d) => d.text).join("; ")})`
                  : "") +
                "; whether it imports an unlisted Radix package cannot be proven.",
            ),
          );
          continue;
        }

        for (const { specifier, line } of moduleSpecifiersIn(sourceFile)) {
          if (!isRadixSpecifier(specifier)) continue;
          const key = `${relative}\n${specifier}`;
          if (known.has(key)) {
            matchedKnownKeys.add(key);
            continue;
          }
          failures.push(
            violation(
              relative,
              `line ${line} imports \`${specifier}\`, which is not listed in ` +
                `${KNOWN_RADIX_RELATIVE_PATH}. Either replace it with a Base UI equivalent ` +
                "or a small local implementation the way #9 did for `Slot` " +
                "(apps/web/src/lib/slot.tsx), or add a row to " +
                `${KNOWN_RADIX_RELATIVE_PATH} naming exactly this file, this package, and why.`,
            ),
          );
        }
      }
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
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
    ok: `legacy UI directory empty; 0 unlisted Radix import(s), ${knownRows.length} tracked row(s), all current.`,
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

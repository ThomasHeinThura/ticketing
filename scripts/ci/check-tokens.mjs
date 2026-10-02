#!/usr/bin/env node

/**
 * check:tokens — the design-token half of gate G2 ("Tokens only") and the "concrete
 * values in light and dark" half of issue #9's own "Done when" line
 * (docs/02-design/ux-quality-gates.md's G2; docs/02-design/design-tokens.md's
 * "Enforcement" section).
 *
 * The gate enforces theme parity, hard-coded literal rejection, and registered density-slot
 * behavior. G3's built-CSS browser runner is `check-contrast.mjs` and runs in the same
 * `check:tokens` command.
 *
 * Static checks enforced here:
 *
 * 1. **Theme parity.** `packages/ui/src/styles/tokens.css` and `theme.css` must exist, and
 *    every semantic token `theme.css` declares in its light block (`:root`) must also be
 *    declared, with a non-empty value, in its dark block (`.dark`) — and vice versa. This
 *    is the literal "concrete values in light and dark" acceptance line: a token with no
 *    dark value, or an empty value in either theme, is a HARD FAILURE.
 * 2. **No hard-coded color literal outside the token files.** A hex color, or an
 *    `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()` call with a literal (non-`var()`) argument,
 *    anywhere outside `packages/ui/src/styles/`, is a HARD FAILURE — a component reaches
 *    for an existing semantic token instead of inventing a one-off color. Matched only
 *    inside an actual string/CSS-value position (a quoted string in code, a bracketed
 *    Tailwind arbitrary value, or a bare CSS declaration), never bare in prose — so a
 *    comment that merely *mentions* something hex-shaped (`"issue #4c9` never happens, but
 *    `"#123"` easily could as an issue number or a test id) is not mistaken for a real
 *    color.
 *
 * **Scope of check 2, deliberately narrowed to the design-system surface**: only
 * `apps/web/src/**` and `packages/ui/**` (outside `packages/ui/src/styles/`) are scanned —
 * not the whole repository. Measured against the actual tree, a hex-shaped string is
 * frequently legitimate DATA elsewhere and would otherwise flood this gate with noise, not
 * findings: `packages/email`'s templates hard-code colors on purpose (email clients cannot
 * resolve a CSS custom property, so an email template is never able to use the token
 * system at all); `tests/api-integration/**` and `label-color.ts`'s own round-trip test
 * construct labels with an arbitrary user-supplied hex color, which is real domain data
 * (a label's own color field), not a design-system color invented by a component. Neither
 * class is a G2 violation, and excluding them by directory (rather than by an
 * ever-growing per-file list) is what keeps this gate meaningful rather than noisy.
 *
 * The inherited arbitrary-spacing/radius/z-index policy remains intentionally bounded to
 * the declared density slots; arbitrary utility cleanup outside that inventory is not
 * claimed by this gate. G3's separate Chromium runner resolves the built stylesheet.
 *
 * Usage:
 *   node scripts/ci/check-tokens.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import {
  finish,
  readText,
  rel,
  repoRoot,
  violation,
  walk,
} from "./lib/repo.mjs";

const NAME = "check:tokens";
const STYLES_DIR = "packages/ui/src/styles";
const TOKENS_CSS = `${STYLES_DIR}/tokens.css`;
const THEME_CSS = `${STYLES_DIR}/theme.css`;
const DENSITY_COMPONENTS = new Map([
  ["packages/ui/src/components/table.tsx", ["table-row", "td-density-row"]],
  [
    "packages/ui/src/components/input.tsx",
    ["input-control", "td-density-field"],
  ],
  ["packages/ui/src/components/card.tsx", ["@CardPanel", "td-density-card"]],
]);

function densitySlotViolations(sourceFile, relativePath) {
  const failures = [];
  const expected = DENSITY_COMPONENTS.get(relativePath);
  function checkClasses(classes, slot) {
    const densityClass = new RegExp(
      `(?:^|[\\s"'\x60])${expected[1]}(?:$|[\\s"'\x60])`,
    );
    if (!densityClass.test(classes)) {
      failures.push(`${relativePath}: <${slot}> must use ${expected[1]}.`);
    }
    const directSpacing =
      expected[0] === "@CardPanel"
        ? /(?:^|[\s"'`])p-\d+(?:\/\d+)?(?:$|[\s"'`])/
        : /(?:^|[\s"'`])(?:py|pt|pb|gap-y|gap)-\d+(?:\/\d+)?(?:$|[\s"'`])/;
    if (directSpacing.test(classes)) {
      failures.push(
        `${relativePath}: <${slot}> has fixed padding/gap; use its registered density class.`,
      );
    }
  }
  function visit(node) {
    if (
      expected?.[0] === "@CardPanel" &&
      node.kind === ts.SyntaxKind.FunctionDeclaration &&
      node.name?.text === "CardPanel"
    ) {
      checkClasses(node.getText(sourceFile), "CardPanel");
    }
    if (
      node.kind === ts.SyntaxKind.JsxOpeningElement ||
      node.kind === ts.SyntaxKind.JsxSelfClosingElement
    ) {
      const attributes = node.attributes?.properties ?? [];
      const slot = attributes.find(
        (attribute) =>
          attribute.kind === ts.SyntaxKind.JsxAttribute &&
          attribute.name?.getText(sourceFile) === "data-slot" &&
          attribute.initializer?.kind === ts.SyntaxKind.StringLiteral,
      )?.initializer?.text;
      const isTarget =
        expected && expected[0] !== "@CardPanel" && slot === expected[0];
      if (isTarget) {
        // The AST selects the exact JSX element; inspecting its serialized opening tag also
        // includes wrapper calls such as cn(...) without confusing adjacent elements.
        checkClasses(node.getText(sourceFile), slot);
      }
    }
    node.forEachChild(visit);
  }
  visit(sourceFile);
  return failures;
}

function densityProbeFailures() {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdesk-density-probe-"));
  const negativePath = path.join(directory, "negative.tsx");
  const positivePath = path.join(directory, "positive.tsx");
  const negativeCardPath = path.join(directory, "negative-card.tsx");
  const positiveCardPath = path.join(directory, "positive-card.tsx");
  writeFileSync(
    negativePath,
    'const item = <tr data-slot="table-row" className="py-3" />;',
  );
  writeFileSync(
    positivePath,
    'const item = <tr data-slot="table-row" className="td-density-row" />;',
  );
  writeFileSync(
    negativeCardPath,
    'function CardPanel() { return <div className="flex-1 p-6" />; }',
  );
  writeFileSync(
    positiveCardPath,
    'function CardPanel() { return <div className="flex-1 td-density-card" />; }',
  );
  const parser = new API({ cwd: directory });
  try {
    const snapshot = parser.updateSnapshot({
      openFiles: [
        negativePath,
        positivePath,
        negativeCardPath,
        positiveCardPath,
      ],
    });
    try {
      const negative = snapshot
        .getDefaultProjectForFile(negativePath)
        ?.program.getSourceFile(negativePath);
      const positive = snapshot
        .getDefaultProjectForFile(positivePath)
        ?.program.getSourceFile(positivePath);
      const negativeCard = snapshot
        .getDefaultProjectForFile(negativeCardPath)
        ?.program.getSourceFile(negativeCardPath);
      const positiveCard = snapshot
        .getDefaultProjectForFile(positiveCardPath)
        ?.program.getSourceFile(positiveCardPath);
      const issues = negative
        ? densitySlotViolations(
            negative,
            "packages/ui/src/components/table.tsx",
          )
        : [];
      const safe = positive
        ? densitySlotViolations(
            positive,
            "packages/ui/src/components/table.tsx",
          )
        : ["positive JSX fixture did not parse"];
      const cardIssues = negativeCard
        ? densitySlotViolations(
            negativeCard,
            "packages/ui/src/components/card.tsx",
          )
        : [];
      const safeCard = positiveCard
        ? densitySlotViolations(
            positiveCard,
            "packages/ui/src/components/card.tsx",
          )
        : ["positive CardPanel fixture did not parse"];
      const failures = [];
      if (!issues.some((message) => message.includes("fixed padding/gap")))
        failures.push(
          "density negative probe did not reject a hard-coded py-3 row",
        );
      if (safe.length)
        failures.push("density positive probe rejected a semantic row class");
      if (
        !cardIssues.some((message) => message.includes("fixed padding/gap"))
      ) {
        failures.push(
          "density negative probe did not reject fixed padding on CardPanel",
        );
      }
      if (safeCard.length)
        failures.push(
          "density positive probe rejected CardPanel density class",
        );
      return failures;
    } finally {
      snapshot.dispose();
    }
  } finally {
    parser.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Where a hard-coded color literal could plausibly be a design-system defect, per this
 * file's own header comment. Deliberately narrower than the whole repo.
 */
const COLOR_LITERAL_SCAN_ROOTS = ["apps/web/src", "packages/ui"];

/**
 * Files that legitimately handle a hex-shaped STRING as data, not as a design color, even
 * within the scanned roots: `label-color.ts`'s own round-trip test intentionally preserves
 * an arbitrary hex color a user or an imported system supplied for a label, and the
 * identifier-search test uses `"#123"` as an issue-number-shaped search query, not a color
 * at all. Both are excluded by exact path — narrowed to these two files, not a blanket
 * test-file exemption, so a real component test that hardcodes a color is still caught.
 * (This checker's own file, full of hex-shaped example text in its header comment and
 * pattern definitions, needs no such exclusion: it lives under `scripts/ci/`, outside both
 * scanned roots.)
 */
const COLOR_LITERAL_DATA_FILES = new Set([
  "apps/web/src/lib/label-color.test.ts",
  "apps/web/src/hooks/use-task-filters-with-labels-support.test.tsx",
]);

const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const cssExtensions = new Set([".css"]);

function isScannable(relativePath) {
  const ext = path.extname(relativePath);
  return codeExtensions.has(ext) || cssExtensions.has(ext);
}

/** Extract `--name: value;` custom-property declarations from a single `{ ... }` block body. */
function declarationsIn(block) {
  const map = new Map();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m = re.exec(block);
  while (m !== null) {
    map.set(m[1], m[2].trim());
    m = re.exec(block);
  }
  return map;
}

/**
 * The body of the first top-level block whose selector line matches `selectorRe`,
 * brace-depth aware (so a nested `@keyframes` block inside `@theme inline` does not end
 * the outer block early).
 */
function findBlock(source, selectorRe) {
  const match = selectorRe.exec(source);
  if (!match) return null;

  let depth = 0;
  let start = -1;
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

/**
 * Every theme-parity problem in `theme.css`'s `:root` (light) vs `.dark` (dark) blocks:
 * a missing block, a token declared in one theme and not the other, or an empty value.
 *
 * @param {string} themeSource raw contents of theme.css
 * @returns {string[]} violation() lines, or [] when both themes are concrete and in parity
 */
export function themeParityViolations(themeSource) {
  const failures = [];
  const light = findBlock(themeSource, /(?:^|\n)\s*:root\s*\{/);
  const dark = findBlock(themeSource, /(?:^|\n)\s*\.dark\s*\{/);

  if (light === null) {
    failures.push(
      violation(
        THEME_CSS,
        "has no top-level `:root { ... }` light-theme block — nothing to check for " +
          "concrete light-theme values against.",
      ),
    );
  }
  if (dark === null) {
    failures.push(
      violation(
        THEME_CSS,
        "has no top-level `.dark { ... }` dark-theme block — nothing to check for " +
          "concrete dark-theme values against.",
      ),
    );
  }
  if (light === null || dark === null) return failures;

  const lightTokens = declarationsIn(light);
  const darkTokens = declarationsIn(dark);

  for (const [name, value] of lightTokens) {
    if (value === "") {
      failures.push(
        violation(THEME_CSS, `\`--${name}\` has an empty value in :root.`),
      );
    }
    if (!darkTokens.has(name)) {
      failures.push(
        violation(
          THEME_CSS,
          `\`--${name}\` is declared in :root but has no .dark value — not concrete in ` +
            "both themes.",
        ),
      );
    }
  }
  for (const [name, value] of darkTokens) {
    if (value === "") {
      failures.push(
        violation(THEME_CSS, `\`--${name}\` has an empty value in .dark.`),
      );
    }
    if (!lightTokens.has(name)) {
      failures.push(
        violation(
          THEME_CSS,
          `\`--${name}\` is declared in .dark but has no :root value — not concrete in ` +
            "both themes.",
        ),
      );
    }
  }

  return failures;
}

const HEX_SHAPE = "#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})";

/** A hex color as an actual JS/TS string literal: `"#fff"` or `'#3b82f6'` — quotes matched. */
const QUOTED_HEX = new RegExp(`(["'])(${HEX_SHAPE})\\1`, "g");
/** A hex color as a Tailwind arbitrary value: `bg-[#fff]`, `text-[#3b82f6]`. */
const BRACKET_HEX = new RegExp(`-\\[${HEX_SHAPE}\\]`, "g");
/** A literal (non-`var()`) color function call: `rgb(`/`rgba(`/`hsl(`/`hsla(`/`oklch(`. */
const COLOR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla|oklch)\(\s*[0-9.]/g;
/** A bare hex color in raw CSS: `color: #4c9aff;` (no quotes — CSS values are unquoted). */
const BARE_CSS_HEX = new RegExp(`(?<![\\w#])${HEX_SHAPE}\\b`, "g");

/** Strip `/* ... *\/` CSS comments so a hex-shaped issue reference in a comment (`#274`) is never mistaken for a color declaration. */
function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    " ".repeat(comment.length),
  );
}

/**
 * Every hard-coded color literal in a single file's source, given whether it is CSS
 * (bare hex allowed, comments stripped first) or code (hex only inside real quotes/
 * brackets, so a comment or issue reference like `"#175"`-shaped prose text used as
 * something other than a color is never the concern here — see this file's own
 * COLOR_LITERAL_DATA_FILES for the two narrow, real exceptions that remain).
 *
 * @param {string} source raw file contents
 * @param {boolean} isCss whether this file is a `.css` file
 * @returns {string[]} each literal exactly as it appears in source, for reporting
 */
export function colorLiteralsIn(source, isCss) {
  const found = [];
  const text = isCss ? stripCssComments(source) : source;
  const patterns = isCss
    ? [BARE_CSS_HEX, COLOR_FUNCTION]
    : [QUOTED_HEX, BRACKET_HEX, COLOR_FUNCTION];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m = re.exec(text);
    while (m !== null) {
      found.push(m[0]);
      m = re.exec(text);
    }
  }
  return found;
}

async function main() {
  const failures = [];

  let tokensSource;
  let themeSource;
  try {
    tokensSource = await readText(path.join(repoRoot, TOKENS_CSS));
  } catch (error) {
    failures.push(
      violation(
        TOKENS_CSS,
        `could not be read (${error.code ?? error.message}).`,
      ),
    );
  }
  try {
    themeSource = await readText(path.join(repoRoot, THEME_CSS));
  } catch (error) {
    failures.push(
      violation(
        THEME_CSS,
        `could not be read (${error.code ?? error.message}).`,
      ),
    );
  }

  if (tokensSource !== undefined && tokensSource.trim() === "") {
    failures.push(
      violation(TOKENS_CSS, "is empty — no primitive tokens declared."),
    );
  }
  if (themeSource !== undefined) {
    failures.push(...themeParityViolations(themeSource));
  }

  const filesPerRoot = await Promise.all(
    COLOR_LITERAL_SCAN_ROOTS.map((root) =>
      walk(path.join(repoRoot, root), isScannable),
    ),
  );
  const files = filesPerRoot.flat().sort();

  for (const absolute of files) {
    const relative = rel(absolute);
    if (relative.startsWith(`${STYLES_DIR}/`)) continue;
    if (COLOR_LITERAL_DATA_FILES.has(relative)) continue;

    const source = await readText(absolute);
    const isCss = path.extname(relative) === ".css";
    for (const literal of colorLiteralsIn(source, isCss)) {
      failures.push(
        violation(
          relative,
          `hard-codes the color \`${literal}\` instead of an existing token from ` +
            `${STYLES_DIR}/. Reach for an existing --color-*/semantic token (extend ` +
            `${STYLES_DIR}/theme.css if none fits) rather than inventing one here.`,
        ),
      );
    }
  }

  const densityPaths = [...DENSITY_COMPONENTS.keys()].map((relative) =>
    path.join(repoRoot, relative),
  );
  const parser = new API({ cwd: repoRoot });
  try {
    const snapshot = parser.updateSnapshot({ openFiles: densityPaths });
    try {
      for (const absolute of densityPaths) {
        const relative = rel(absolute);
        const sourceFile = snapshot
          .getDefaultProjectForFile(absolute)
          ?.program.getSourceFile(absolute);
        if (!sourceFile) {
          failures.push(
            violation(
              relative,
              "could not be parsed for the density-slot gate.",
            ),
          );
          continue;
        }
        failures.push(
          ...densitySlotViolations(sourceFile, relative).map((message) =>
            violation(relative, message),
          ),
        );
      }
    } finally {
      snapshot.dispose();
    }
  } finally {
    parser.close();
  }
  failures.push(
    ...densityProbeFailures().map((message) =>
      violation("scripts/ci/check-tokens.mjs", message),
    ),
  );

  finish({
    name: NAME,
    failures,
    ok: "theme.css tokens are concrete in both themes; density slots are enforced; no hard-coded color literal outside packages/ui/src/styles/.",
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}

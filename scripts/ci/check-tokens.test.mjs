/**
 * check:tokens — unit tests for the pure theme-parity and color-literal-scan functions,
 * against fixture strings built inline here — never the real repo tree or the real
 * theme.css, so a future edit to either cannot make this suite pass or fail for the wrong
 * reason (the same discipline check-ui.test.mjs uses for its own fixtures).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { colorLiteralsIn, themeParityViolations } from "./check-tokens.mjs";

function theme({ light, dark }) {
  return [
    "@theme inline {",
    "  --color-foreground: var(--foreground);",
    "}",
    "",
    ":root {",
    ...light.map((line) => `  ${line}`),
    "}",
    "",
    ".dark {",
    ...dark.map((line) => `  ${line}`),
    "}",
    "",
  ].join("\n");
}

describe("check:tokens — themeParityViolations", () => {
  it("passes when every token has a concrete value in both themes", () => {
    const source = theme({
      light: ["--foreground: var(--color-neutral-800);"],
      dark: ["--foreground: var(--color-neutral-100);"],
    });
    assert.deepEqual(themeParityViolations(source), []);
  });

  it("fails when a token is declared in :root but missing from .dark", () => {
    const source = theme({
      light: ["--foreground: var(--color-neutral-800);", "--accent: black;"],
      dark: ["--foreground: var(--color-neutral-100);"],
    });
    const failures = themeParityViolations(source);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /--accent/);
    assert.match(failures[0], /no \.dark value/);
  });

  it("fails when a token is declared in .dark but missing from :root", () => {
    const source = theme({
      light: ["--foreground: var(--color-neutral-800);"],
      dark: ["--foreground: var(--color-neutral-100);", "--accent: white;"],
    });
    const failures = themeParityViolations(source);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /--accent/);
    assert.match(failures[0], /no :root value/);
  });

  it("fails on an empty value in either theme", () => {
    const source = theme({
      light: ["--foreground: ;"],
      dark: ["--foreground: var(--color-neutral-100);"],
    });
    const failures = themeParityViolations(source);
    assert.ok(failures.some((f) => /empty value in :root/.test(f)));
  });

  it("fails when the :root block is missing entirely", () => {
    const source = ".dark {\n  --foreground: white;\n}\n";
    const failures = themeParityViolations(source);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no top-level `:root/);
  });

  it("fails when the .dark block is missing entirely", () => {
    const source = ":root {\n  --foreground: black;\n}\n";
    const failures = themeParityViolations(source);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no top-level `\.dark/);
  });

  it("does not let a nested @keyframes block inside @theme inline end :root early", () => {
    // Regression guard for the brace-depth-aware block finder: a naive
    // "first matching close brace" scan would stop at @keyframes's own `}` well before
    // reaching the real end of :root, if :root came after an @theme inline with a nested
    // block. Here :root legitimately closes after both its declarations.
    const source = [
      "@theme inline {",
      "  @keyframes skeleton {",
      "    to { background-position: -200% 0; }",
      "  }",
      "}",
      "",
      ":root {",
      "  --foreground: var(--color-neutral-800);",
      "  --background: var(--color-white);",
      "}",
      "",
      ".dark {",
      "  --foreground: var(--color-neutral-100);",
      "  --background: var(--color-neutral-950);",
      "}",
      "",
    ].join("\n");
    assert.deepEqual(themeParityViolations(source), []);
  });
});

describe("check:tokens — colorLiteralsIn — code files", () => {
  it("finds a quoted 6-digit hex color", () => {
    assert.deepEqual(colorLiteralsIn('const x = "#3b82f6";', false), [
      '"#3b82f6"',
    ]);
  });

  it("finds a quoted 3-digit hex color", () => {
    assert.deepEqual(colorLiteralsIn("const x = '#fff';", false), ["'#fff'"]);
  });

  it("finds a Tailwind arbitrary hex bracket value", () => {
    assert.deepEqual(colorLiteralsIn('className="bg-[#4c9aff]"', false), [
      "-[#4c9aff]",
    ]);
  });

  it("finds a literal rgb() call", () => {
    assert.deepEqual(colorLiteralsIn("rgb(59 130 246)", false), ["rgb(5"]);
  });

  it("does not flag a var()-based color function", () => {
    assert.deepEqual(
      colorLiteralsIn(
        "color-mix(in srgb, var(--foreground) 88%, var(--info) 12%)",
        false,
      ),
      [],
    );
  });

  it("does not flag an issue-number-shaped comment", () => {
    // The exact false-positive class this checker must not repeat: a bare "#310" in prose
    // is not inside a string literal, so QUOTED_HEX never matches it.
    assert.deepEqual(
      colorLiteralsIn("// fixed in #310, see also #175", false),
      [],
    );
  });

  it("does not flag a quoted string that merely CONTAINS a hex-shaped substring", () => {
    // "#175's decision" is not itself a hex-shaped string (extra text after the digits),
    // so it must not be mistaken for a 3-digit hex literal ("#175" has 3 hex digits after
    // the #, but the closing quote is not immediately after them here).
    assert.deepEqual(
      colorLiteralsIn('"see issue #175 for context"', false),
      [],
    );
  });

  it("does not flag mismatched quote characters", () => {
    assert.deepEqual(colorLiteralsIn(`"#192'`, false), []);
  });
});

describe("check:tokens — colorLiteralsIn — CSS files", () => {
  it("finds a bare hex color in a CSS declaration", () => {
    assert.deepEqual(
      colorLiteralsIn(
        "color: color-mix(in srgb, var(--x) 88%, #4c9aff 12%);",
        true,
      ),
      ["#4c9aff"],
    );
  });

  it("ignores a hex-shaped issue reference inside a CSS comment", () => {
    assert.deepEqual(
      colorLiteralsIn(
        "/* found by #274's browser check */\ncolor: var(--foreground);",
        true,
      ),
      [],
    );
  });

  it("does not flag a var() reference", () => {
    assert.deepEqual(colorLiteralsIn("color: var(--foreground);", true), []);
  });
});

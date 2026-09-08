// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are TEST DATA about template substitutions — a literal `${` is the whole point
/**
 * Unit tests for the code-comment scanner.
 *
 * These exist because the scanner is a security-adjacent sanitiser, in the same sense
 * `pr-body.mjs`'s `stripComments` is: CodeQL raised
 * `js/incomplete-multi-character-sanitization` (HIGH) on the regex that preceded that
 * one. A hand-written scanner without a regression test is one careless edit from the
 * same hole, so the invariants are asserted directly.
 *
 * The load-bearing property is asymmetric: a REAL disabled test must always be visible,
 * and prose or test data mentioning one must never be.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripCodeComments } from "./strip-code-comments.mjs";

const banned = /\bit\s*\.\s*skip\s*\(/;
const scan = (source) =>
  banned.test(stripCodeComments(source, { blankStrings: true }));

describe("stripCodeComments — a real skip stays visible", () => {
  for (const [name, source] of [
    ["a bare call", 'it.skip("x", () => {});'],
    ["indented", '  it.skip("x", () => {});'],
    ["spaced", "it . skip ( 'x' );"],
    ["after code on the same line", 'const a = 1; it.skip("x", () => {});'],
    ["inside a describe", 'describe("d", () => { it.skip("x", () => {}); });'],
  ]) {
    it(`still finds ${name}`, () => {
      assert.equal(scan(source), true);
    });
  }
});

describe("stripCodeComments — prose and data never trip it", () => {
  for (const [name, source] of [
    ["a line comment", "// never use it.skip( here"],
    ["a block comment", "/* it.skip( is banned */"],
    ["a jsdoc comment", "/**\n * `it.skip(` and friends.\n */"],
    ["a double-quoted string", 'const s = "it.skip(";'],
    ["a single-quoted string", "const s = 'it.skip(';"],
    ["a template literal", "const s = `it.skip(`;"],
    ["an assertion on the text", 'assert.match(out, "it.skip(");'],
    ["a comment after code", "const a = 1; // it.skip( explained"],
  ]) {
    it(`ignores ${name}`, () => {
      assert.equal(scan(source), false);
    });
  }
});

describe("stripCodeComments — the contexts a `//` hides in", () => {
  it("does not treat a URL inside a string as a comment", () => {
    const out = stripCodeComments('const u = "http://example.test/x";');
    assert.match(out, /http:\/\/example\.test\/x/);
  });

  it("does not treat a regex containing // as a comment", () => {
    const out = stripCodeComments("const r = /a\\/\\/b/;");
    assert.match(out, /a\\\/\\\/b/);
  });

  it("handles an escaped quote inside a string", () => {
    assert.equal(scan('const s = "a\\"b"; it.skip("x");'), true);
  });

  it("handles a template substitution containing a comment", () => {
    // The substitution is code, so its comment must come out; the surrounding
    // template must still terminate correctly rather than swallowing the file.
    const out = stripCodeComments("const s = `a${/* c */ 1}b`;\nit.skip('x');");
    assert.match(out, /it\.skip/);
  });

  it("preserves line count through a block comment, so reported lines are real", () => {
    const source = "const a = 1;\n/*\n\n\n*/\nit.skip('x');";
    const out = stripCodeComments(source, { blankStrings: true });
    const line = out.slice(0, out.search(banned)).split("\n").length;
    assert.equal(line, 6, `expected the skip on line 6, got ${line}`);
  });

  it("leaves an unterminated string from running away with the file", () => {
    const out = stripCodeComments('const s = "unterminated\nit.skip("x");');
    assert.equal(typeof out, "string");
  });
});

/**
 * A3 — lexical state INSIDE a `${...}` substitution.
 *
 * The first scanner found a substitution's end by counting raw braces and then recursed on
 * the slice, dropping `options` on the way. A `}` inside a string, a regex, a comment or a
 * nested template therefore closed the substitution early, and the remainder of the
 * expression — which really does execute — was read as inert template text and blanked.
 *
 * `braceCounted` below is that exact pre-fix algorithm, kept here as the non-vacuity
 * control: every case asserts the OLD scanner hid the call and the shipped one does not.
 * Without the control these would be five assertions that happen to pass.
 */
function braceCounted(source, options = {}) {
  const blankStrings = options.blankStrings === true;
  const out = [];
  let i = 0;
  const templates = [];
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out.push(" ");
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      out.push(" ");
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        if (source[i] === "\n") out.push("\n");
        i += 1;
      }
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      out.push(char);
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out.push(blankStrings ? "  " : `${source[i]}${source[i + 1] ?? ""}`);
          i += 2;
          continue;
        }
        const terminator = source[i] === char || source[i] === "\n";
        out.push(terminator || !blankStrings ? source[i] : " ");
        if (terminator) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (char === "`") {
      out.push(char);
      i += 1;
      templates.push(true);
      while (i < source.length && templates.length > 0) {
        if (source[i] === "\\") {
          out.push(source[i], source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          out.push(source[i]);
          i += 1;
          templates.pop();
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          out.push("$", "{");
          i += 2;
          let depth = 1;
          const start = i;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            if (depth > 0) i += 1;
          }
          // The pre-fix recursion, options and all: dropped.
          out.push(braceCounted(source.slice(start, i)));
          out.push("}");
          i += 1;
          continue;
        }
        out.push(blankStrings && source[i] !== "\n" ? " " : source[i]);
        i += 1;
      }
      continue;
    }
    out.push(char);
    i += 1;
  }
  return out.join("");
}

const oldScan = (source) =>
  banned.test(braceCounted(source, { blankStrings: true }));

describe("A3 — a skip cannot hide behind a brace inside a substitution", () => {
  for (const [name, source] of [
    [
      "a `}` inside a string in the substitution",
      'const a = `${ ["}"].map(() => it.skip("real", fn)) }`;',
    ],
    [
      "a `}` inside a regex in the substitution",
      'const a = `${ /}/.test(x) ? it.skip("real", fn) : 0 }`;',
    ],
    [
      "a `}` inside a comment in the substitution",
      'const a = `${ (0, // }\n it.skip("real", fn)) }`;',
    ],
  ]) {
    it(`sees the call past ${name}`, () => {
      // NON-VACUITY: the pre-fix scanner blanked the call away entirely.
      assert.equal(
        oldScan(source),
        false,
        "the pre-fix scanner must MISS this call, or the case is not the A3 defect",
      );
      assert.equal(
        scan(source),
        true,
        `the shipped scanner must still see the call:\n${stripCodeComments(source, { blankStrings: true })}`,
      );
    });
  }

  /**
   * Nested-template shapes the shipped scanner must handle — but NOT bypasses.
   *
   * These two were written as A3 cases and the non-vacuity control rejected them: the
   * pre-fix scanner saw the call in both. The reason is worth keeping, because it is the
   * other half of the old bug. Its recursion dropped `options`, so anything inside a
   * substitution went UNBLANKED; when the brace mis-count cut the substitution short and
   * then ran into a second `${`, it recursed again and the call survived. The old scanner
   * was simultaneously too weak about extent and too weak about blanking, and only the
   * first of those hides a call.
   *
   * So they are asserted as behaviour, without claiming a bypass they do not reproduce.
   */
  for (const [name, source] of [
    [
      "a nested template whose TEXT contains a brace",
      'const a = `${ `text } more ${ it.skip("real", fn) }` }`;',
    ],
    [
      "a quoted brace inside a nested substitution",
      "const a = `${ f(`${ g('}') || it.skip(\"real\", fn) }`) }`;",
    ],
  ]) {
    it(`handles ${name}`, () => {
      assert.equal(
        scan(source),
        true,
        `the shipped scanner must see the call:\n${stripCodeComments(source, { blankStrings: true })}`,
      );
    });
  }

  it("still treats a STRING inside a substitution as data, not code", () => {
    // The other half of the rule, and the reason `blankStrings` has to travel with the
    // state rather than be dropped by a recursive call: code in a substitution executes
    // and must be scanned, while a string literal in there is still test data.
    assert.equal(scan('const a = `${ label("it.skip(") }`;'), false);
  });

  it("still blanks ordinary template TEXT around a substitution", () => {
    assert.equal(scan("const a = `it.skip( ${ 1 } it.skip(`;"), false);
  });

  it("keeps the substitution's own line numbering", () => {
    const source = 'const a = `${\n  ["}"].join()\n}`;\nit.skip("x");';
    const out = stripCodeComments(source, { blankStrings: true });
    const line = out.slice(0, out.search(banned)).split("\n").length;
    assert.equal(line, 4, `expected the skip on line 4, got ${line}`);
  });

  it("terminates on a substitution that is never closed", () => {
    const out = stripCodeComments('const a = `${ ["}"] ', {
      blankStrings: true,
    });
    assert.equal(typeof out, "string");
  });
});

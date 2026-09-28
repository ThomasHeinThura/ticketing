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

/**
 * Issue #143 — a `/` right after a KEYWORD (`return`, `typeof`, …) is a regex literal, not
 * division, but the pre-#143 scanner only ever looked at the single previous CHARACTER.
 * A keyword ends in a word character the same way an identifier does, and no word character
 * was in `REGEX_ALLOWED_BEFORE`, so `return /['"]/` was read as "division, then a `'` opens
 * a string" — which swallows the rest of the line, real code included.
 *
 * `oldScan` below is that exact pre-#143 heuristic (single-character lookback), kept as the
 * non-vacuity control for the same reason `braceCounted` is above: without it these would be
 * assertions that happen to pass, not a demonstrated regression fix.
 */
const OLD_REGEX_ALLOWED_BEFORE = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "\n",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

function oldPreviousMeaningful(out) {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const char = out[i];
    if (char !== " " && char !== "\t" && char !== "\r") return char;
  }
  return "\n";
}

function preIssue143Scanner(source, options = {}) {
  const blankStrings = options.blankStrings === true;
  const out = [];
  let i = 0;
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
    if (
      char === "/" &&
      OLD_REGEX_ALLOWED_BEFORE.has(oldPreviousMeaningful(out))
    ) {
      out.push(char);
      i += 1;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          out.push(source[i], source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        out.push(source[i]);
        if ((source[i] === "/" && !inClass) || source[i] === "\n") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out.push(char);
    i += 1;
  }
  return out.join("");
}

const oldKeywordScan = (source) =>
  banned.test(preIssue143Scanner(source, { blankStrings: true }));

describe("issue #143 — regex after a keyword is not division", () => {
  const cases = [
    [
      "return, quoted regex, real call on the same line",
      'function f(x) { return /[\'"]/.test(x); it.skip("real", fn); }',
    ],
    [
      "typeof, quoted regex, real call on the same line",
      'x = typeof /\'/.test(y); it.skip("real", fn);',
    ],
    [
      "case, quoted regex, real call on the same line",
      'switch (x) { case /\'/.test(y): it.skip("real", fn); }',
    ],
  ];

  for (const [name, source] of cases) {
    it(`sees the call past ${name}`, () => {
      // NON-VACUITY: the pre-#143 scanner (single-character lookback) must miss this call,
      // or the case does not reproduce the issue.
      assert.equal(
        oldKeywordScan(source),
        false,
        "the pre-#143 scanner must MISS this call, or the case is not the #143 defect",
      );
      assert.equal(
        scan(source),
        true,
        `the shipped scanner must still see the call:\n${stripCodeComments(source, { blankStrings: true })}`,
      );
    });
  }

  it("still tells a real division from a regex (no regression, proves something)", () => {
    // Opus security review: a plain `assert.match(out, /a \/ b/)` proves nothing, because
    // code inside a MISREAD regex is copied through unchanged too -- the old assertion
    // would pass even against a version that treats every previous token as regex-
    // permitting. The real property is that a real division doesn't get misread as
    // opening a regex that then swallows a string containing a `/` and everything after
    // it on the line -- so assert on the call AFTER a string containing a slash, the same
    // shape as the `of`/property-access cases below.
    const source = 'const n = a / b; s = "/"; it.skip("x");';
    assert.equal(
      scan(source),
      true,
      "a real division must not hide the call after it",
    );
  });

  it("Opus security review: `of` is a legal identifier, not always a keyword -- dropped from the allow-list", () => {
    // `let of = 5; return of / 2;` is real code with `of` as a plain variable and `/` as
    // genuine division. Keeping `of` in REGEX_ALLOWED_KEYWORDS bought nothing (a regex
    // object can't be looped over, so `for (x of /re/)` fails at runtime anyway) and cost
    // a real false negative here.
    // Note: the pre-#143 (single-character lookback) scanner already handles this
    // particular input correctly by coincidence (`of` ends in `f`, a word character, so
    // it never matched `REGEX_ALLOWED_BEFORE` either) -- this case isolates the `of`-as-
    // keyword regression this PR's OWN multi-char keyword list introduced, not the
    // original #143 defect, so there is no meaningful pre-#143 baseline to compare here.
    const source = 'let of = 5; x = of / 2; s = "/"; it.skip("a", fn);';
    assert.equal(scan(source), true, "must not hide the call after `of / 2`");
  });

  it("Opus security review: a reserved word used as a PROPERTY NAME is not a keyword either", () => {
    // Every keyword in REGEX_ALLOWED_KEYWORDS is also a legal property name -- `mod.default`,
    // `o.in`, `o.new` are all real, common patterns, and none of them puts a following `/`
    // in regex position: `mod.default / 2` is division, the same as any other property
    // read divided by a number.
    for (const source of [
      'mod.default / 2; s = "/"; it.skip("a", fn);',
      'o.in / 2; s = "/"; it.skip("a", fn);',
      'o.new / 2; s = "/"; it.skip("a", fn);',
    ]) {
      assert.equal(scan(source), true, `must not hide the call in: ${source}`);
    }
  });

  it("Opus security review: optional chaining before a keyword-shaped property name is handled the same way", () => {
    const source = 'o?.default / 2; s = "/"; it.skip("a", fn);';
    assert.equal(
      scan(source),
      true,
      "must not hide the call after `o?.default / 2`",
    );
  });

  it("does not regress: a `.` earlier in the line does not suppress an unrelated keyword's own regex reading", () => {
    // Opus security review (finding C): the previous version of this test had no `.`
    // anywhere near `return`, so it never actually exercised the property this test
    // claims to check. This version puts a real `.` (an unrelated property access)
    // immediately before the line's OWN keyword+regex, proving the `.`-precedes-word
    // check only suppresses the reading for the word directly after that specific dot,
    // not for any keyword appearing anywhere later in the buffer.
    const source = 'a.b; return /[\'"]/.test(x); it.skip("real", fn);';
    assert.equal(scan(source), true);
  });

  it("Opus security review, second pass: a private class field is not a keyword either", () => {
    // Every reserved word in REGEX_ALLOWED_KEYWORDS is also a legal PRIVATE FIELD name
    // (`this.#default`, `this.#in`) -- the first `.`-precedes-word fix only checked for
    // `.` immediately before the word, missing that a private field's `#` sits between
    // the dot and the word (`this.#default`, not `this.default`).
    for (const source of [
      'this.#default / 2; s = "/"; it.skip("a", fn);',
      'this.#in / 2; s = "/"; it.skip("a", fn);',
    ]) {
      assert.equal(scan(source), true, `must not hide the call in: ${source}`);
    }
  });

  it("does not regress: a chained property access is still correctly division, not just a bare property", () => {
    const source = 'a.b.default / 2; s = "/"; it.skip("a", fn);';
    assert.equal(scan(source), true);
  });
});

/**
 * #421 — the exact pre-#421 shipped scanner (the multi-char-keyword-aware version #143's
 * fixes left in place, unchanged in its handling of `)`), kept as the non-vacuity control
 * for the disclosed-gap tests below, the same reason `braceCounted` and
 * `preIssue143Scanner` are kept for their own fixes: without it, "the real call after the
 * regex is visible" would be an assertion that happens to pass, not a demonstrated fix.
 * `)` was never added to `REGEX_ALLOWED_BEFORE` in any #143-era revision, so this is
 * byte-for-byte what shipped immediately before this rewrite.
 */
const PRE_421_REGEX_ALLOWED_BEFORE = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "\n",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const PRE_421_REGEX_ALLOWED_KEYWORDS = new Set([
  "return",
  "typeof",
  "delete",
  "void",
  "throw",
  "new",
  "in",
  "instanceof",
  "case",
  "yield",
  "do",
  "else",
  "await",
  "default",
]);
const PRE_421_WORD_CHAR = /[A-Za-z0-9_$]/;

function pre421PreviousMeaningful(out) {
  let i = out.length - 1;
  while (i >= 0 && (out[i] === " " || out[i] === "\t" || out[i] === "\r")) {
    i -= 1;
  }
  if (i < 0) return "\n";
  if (!PRE_421_WORD_CHAR.test(out[i])) return out[i];
  let start = i;
  while (start > 0 && PRE_421_WORD_CHAR.test(out[start - 1])) start -= 1;
  if (start > 0 && (out[start - 1] === "." || out[start - 1] === "#")) {
    return ".";
  }
  return out.slice(start, i + 1).join("");
}

function pre421AllowsRegex(token) {
  return token.length === 1
    ? PRE_421_REGEX_ALLOWED_BEFORE.has(token)
    : PRE_421_REGEX_ALLOWED_KEYWORDS.has(token);
}

function preIssue421Scanner(source, options = {}) {
  const blankStrings = options.blankStrings === true;
  const out = [];
  let i = 0;
  const stack = [{ kind: "code", brace: 0 }];
  const top = () => stack[stack.length - 1];

  const readString = (quote) => {
    out.push(quote);
    i += 1;
    while (i < source.length) {
      if (source[i] === "\\") {
        out.push(blankStrings ? "  " : `${source[i]}${source[i + 1] ?? ""}`);
        i += 2;
        continue;
      }
      const terminator = source[i] === quote || source[i] === "\n";
      out.push(terminator || !blankStrings ? source[i] : " ");
      if (terminator) {
        i += 1;
        return;
      }
      i += 1;
    }
  };

  while (i < source.length) {
    const frame = top();
    if (frame.kind === "template") {
      const char = source[i];
      if (char === "\\") {
        out.push(char, source[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (char === "`") {
        out.push(char);
        i += 1;
        stack.pop();
        continue;
      }
      if (char === "$" && source[i + 1] === "{") {
        out.push("$", "{");
        i += 2;
        stack.push({ kind: "code", brace: 0 });
        continue;
      }
      out.push(blankStrings && char !== "\n" ? " " : char);
      i += 1;
      continue;
    }

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
      readString(char);
      continue;
    }
    if (char === "`") {
      out.push(char);
      i += 1;
      stack.push({ kind: "template" });
      continue;
    }
    if (char === "/" && pre421AllowsRegex(pre421PreviousMeaningful(out))) {
      out.push(char);
      i += 1;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          out.push(source[i], source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        out.push(source[i]);
        if ((source[i] === "/" && !inClass) || source[i] === "\n") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (char === "{") {
      frame.brace += 1;
      out.push(char);
      i += 1;
      continue;
    }
    if (char === "}") {
      if (frame.brace > 0) {
        frame.brace -= 1;
      } else if (stack.length > 1) {
        out.push(char);
        i += 1;
        stack.pop();
        continue;
      }
      out.push(char);
      i += 1;
      continue;
    }
    out.push(char);
    i += 1;
  }
  return out.join("");
}

/**
 * #421 — the disclosed gap the old hand-rolled scanner left open ON PURPOSE (see the
 * previous version of this file's header, and git history): a `)` closing an
 * `if`/`while`/`for`/`switch` condition also puts a following `/` in regex position
 * (`if (x) /y/.test(z)` is legal), but a `)` closing an ordinary call puts it in division
 * position — telling those apart needs real paren-matching back to whichever keyword (if
 * any) opened the matching `(`, which a previous-token lookback cannot do. The real
 * TypeScript parser this file now uses already does that paren-matching as part of
 * ordinary parsing, so this gap closes for free rather than needing a fourth
 * instance-patch. This block now asserts the CORRECT reading in both directions, replacing
 * the old test that pinned the PRE-fix limitation as accepted behaviour — closing a
 * previously-disclosed limitation is the improvement this rewrite exists to make, not a
 * regression to guard against.
 */
describe("issue #143 / #421 — `)` after a control-flow keyword is real paren-matching now", () => {
  it("reads `/` after a condition's `)` as a regex, not division", () => {
    // `if (x) /'/.test(y);` is real code whose `/'/` is a genuine regex literal — the old
    // scanner had no way to know the `)` closed an `if` rather than a call, so it used to
    // read the `'` as a string open and blank the rest of the line (see git history for
    // the pre-#421 version of this test, which pinned exactly that misreading). The real
    // parser resolves this correctly by construction, so the regex — and the real call
    // after it — must both survive untouched.
    const source = "if (x) /'/.test(y);";
    // NON-VACUITY: the pre-#421 scanner must still misread this exact case, or it is not
    // the disclosed gap being closed.
    assert.equal(
      preIssue421Scanner(source, { blankStrings: true }),
      "if (x) /'          ",
      "the pre-#421 scanner's own pinned misreading must be reproduced here first",
    );
    const out = stripCodeComments(source, { blankStrings: true });
    assert.equal(out, "if (x) /'/.test(y);");
  });

  // Only `if`/`while`/`for` can put a regex DIRECTLY after their condition's own `)` with
  // no intervening token — `switch (x)`'s body is always a braced block, so its `)` is
  // always followed by `{`, which the OLD scanner already read correctly (`{` was always
  // in its allow-list for unrelated reasons); `switch` was never actually reachable by
  // this specific gap and is not a discriminating case, so it is not asserted here.
  for (const keyword of ["while", "for"]) {
    it(`reads \`/\` after a \`${keyword}\`'s \`)\` as a regex too, not just \`if\``, () => {
      const source =
        keyword === "for"
          ? "for (;;) /'/.test(y); it.skip('real', fn);"
          : "while (x) /'/.test(y); it.skip('real', fn);";
      // NON-VACUITY: the pre-#421 scanner must MISS this call (same shape as the `if`
      // case above), or this case does not actually exercise the disclosed gap for
      // this keyword.
      assert.equal(
        banned.test(preIssue421Scanner(source, { blankStrings: true })),
        false,
        `the pre-#421 scanner must MISS this call for ${keyword}, or this is not the gap`,
      );
      assert.equal(
        scan(source),
        true,
        "the real call after the regex must still be visible",
      );
    });
  }

  it("still reads `/` after an ORDINARY call's `)` as division, not a regex", () => {
    // The other half of the same fix: paren-matching must tell a control-flow `)` apart
    // from a plain call's `)`, not just stop reading every `)` as division-blocking.
    // `f(x) /y/` is really `f(x) / y /`, a division chain, exactly as before #421 — pinned
    // as an exact string, not just "it.skip is still visible", since this particular shape
    // is well-formed code either way a `)` could be read and so would not by itself expose
    // a regression back to "every `)` opens a regex".
    const source = 'f(x) /y/.exec(w); s = "/"; it.skip("a", fn);';
    const out = stripCodeComments(source, { blankStrings: true });
    assert.equal(out, 'f(x) /y/.exec(w); s = " "; it.skip(" ", fn);');
  });
});

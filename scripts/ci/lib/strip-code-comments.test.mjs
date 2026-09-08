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

#!/usr/bin/env node
/**
 * Remove JavaScript/TypeScript comments so a gate can scan CODE rather than prose.
 *
 * **M3's second half.** Widening `check:skips` to `scripts/ci` made a pre-existing false
 * positive bite: the gate matches its banned patterns anywhere in a test file, comments
 * included. It was always latent, but the CI machinery is exactly where a test legitimately
 * DOCUMENTS the thing it forbids — a probe about skipped tests has to name `it.skip(`
 * somewhere. I hit it immediately: a doc comment reading "`it.skip(` and friends" failed
 * the gate in a clean checkout.
 *
 * Blocking a comment that explains a rule is not enforcing the rule. So comments come out
 * before the scan, and a disabled test is still caught wherever it actually is.
 *
 * A hand-written character scanner, NOT a regex — the same decision, for the same reason,
 * as `pr-body.mjs`'s `stripComments`: CodeQL raised
 * `js/incomplete-multi-character-sanitization` (HIGH) on the regex that preceded it. This
 * one is linear, single-pass, and tracks the three contexts a `//` can hide in:
 *
 *   - string literals, single and double quoted, with escapes
 *   - template literals, including `${...}` substitutions, which nest
 *   - regular-expression literals, distinguished from division by the previous token
 *
 * Comments are replaced by a single space rather than deleted, so byte offsets stay close
 * and reported line numbers remain meaningful: newlines inside a block comment are kept.
 */

/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_ALLOWED_BEFORE = new Set([
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

function previousMeaningful(out) {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const char = out[i];
    if (char !== " " && char !== "\t" && char !== "\r") return char;
  }
  return "\n";
}

/**
 * @param {string} source
 * @param {{ blankStrings?: boolean }} [options] `blankStrings` also blanks the CONTENTS
 *   of string and template literals, keeping the delimiters and the line count. Test DATA
 *   is the other false-positive class: a probe asserting on the text `it.skip(` is not a
 *   skipped test. A genuinely disabled test cannot hide inside a string literal and still
 *   execute, so blanking them removes the class without weakening the gate.
 */
export function stripCodeComments(source, options = {}) {
  const blankStrings = options.blankStrings === true;
  const out = [];
  let i = 0;
  // Stack of template-literal depths; a `${` inside one pushes an expression context.
  const templates = [];

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // ── line comment ──
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out.push(" ");
      continue;
    }

    // ── block comment ── keep newlines so line numbers survive
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

    // ── string literal ──
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

    // ── template literal ──
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
        // `${` opens code again: hand control back to the main loop by recursing on the
        // substitution's text, which keeps nesting correct without a second scanner.
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
          out.push(stripCodeComments(source.slice(start, i)));
          out.push("}");
          i += 1;
          continue;
        }
        out.push(blankStrings && source[i] !== "\n" ? " " : source[i]);
        i += 1;
      }
      continue;
    }

    // ── regex literal ──
    if (char === "/" && REGEX_ALLOWED_BEFORE.has(previousMeaningful(out))) {
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

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
 *
 * **A3 — the substitution extent was found by counting raw braces, and that hid a real
 * disabled test.** The first version located the end of a `${...}` by incrementing on `{`
 * and decrementing on `}` with no idea which context those characters were in, then
 * recursed on the slice — dropping `options` on the way, so a nested string was never
 * blanked. A `}` inside a string, a regex or a comment INSIDE the substitution therefore
 * closed it early, and the rest of the expression — which really does execute — was read
 * as inert template text and blanked away. Demonstrated, not theorised:
 *
 *   const a = `${ ["}"].map(() => it.skip("real", fn)) }`;
 *
 * became `` const a = `${ ["}                                   `; `` and `check:skips`
 * saw no skipped test. That is a gate bypass in the machinery that proves the other gates
 * cannot be switched off silently, and an independent read of the probe suite reached the
 * same input by hand-trace from the other direction.
 *
 * So there is no brace counter and no recursion any more. One loop, one explicit context
 * stack: `${` PUSHES a code context and the matching `}` pops back to template text, while
 * strings, regexes and comments are consumed by the same loop — so their braces are never
 * even looked at, let alone counted. `blankStrings` now travels with the state rather than
 * with a recursive call, which is what makes the two halves of the rule hold at once:
 * template TEXT and string CONTENTS are data and get blanked; the code inside a
 * substitution is code and does not, because a call written there executes.
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

  // The context stack. The bottom frame is always code; `${` pushes another code frame on
  // top of a template frame, and the `}` that balances it pops back. `brace` counts only
  // the braces seen in THIS code frame, so an unbalanced brace inside a string can no
  // longer end a substitution — the string branch below has already consumed it.
  const stack = [{ kind: "code", brace: 0 }];
  const top = () => stack[stack.length - 1];

  /** Consume a string literal. Its CONTENTS are data; its delimiters and newlines stay. */
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

    // ── template TEXT ────────────────────────────────────────────────────────────────
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

    // ── CODE ─────────────────────────────────────────────────────────────────────────
    const char = source[i];
    const next = source[i + 1];

    // line comment
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out.push(" ");
      continue;
    }

    // block comment — keep newlines so line numbers survive
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

    // regex literal, told from division by the previous meaningful character
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

    // Brace bookkeeping, and the one place a code frame ends: the `}` that balances the
    // `${` which opened it. Everything above has already eaten the braces that live
    // inside strings, regexes and comments, which is the whole of the A3 fix.
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

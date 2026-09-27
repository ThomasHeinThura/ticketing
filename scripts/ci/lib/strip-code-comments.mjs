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
 *
 * **Issue #143 — regex vs. division is told apart by the previous TOKEN, not just the
 * previous character, and that still has one disclosed gap.** `previousMeaningful` used to
 * look at a single character, so `return /['"]/` (a real regex, right after a keyword) read
 * the same as an identifier ending in `n` followed by division — both end in a word
 * character, and no word character was in `REGEX_ALLOWED_BEFORE`. The `/` was then read as
 * division and the `'` right after it as a STRING OPEN, which swallows the rest of the
 * line, including any real code sitting after it (an `it.skip(` call, in the worst case).
 * Reproduced directly (see `strip-code-comments.test.mjs`'s "issue #143" block):
 *
 *   function f(x) { return /['"]/.test(x); it.skip("real", fn); }
 *
 * stripped to `... return /['` with the rest of the line, `it.skip(` included, gone.
 * `previousMeaningful` now returns the whole preceding word when there is one, and
 * `REGEX_ALLOWED_KEYWORDS` lists the keywords a real tokenizer also special-cases here
 * (Acorn, Esprima) because each is always followed by the START of an expression, never a
 * value a `/` could divide: `return`, `typeof`, `delete`, `void`, `throw`, `new`, `in`,
 * `of`, `instanceof`, `case`, `yield`, `do`, `else`, `await`, `default`.
 *
 * **Disclosed gap this does NOT close, on purpose:** a `)` that closes an `if` / `while` /
 * `for` / `switch` condition also puts a following `/` in regex position (`if (x) /y/.test(z)`
 * is legal), but a `)` that closes a plain call or grouped expression puts it in division
 * position (`f(x) /y/` divides `f(x)` by `y`, twice). Telling those apart needs to know
 * which keyword (if any) the MATCHING `(` followed — real paren-matching, not a
 * previous-token lookback — which is the token-context-tracking-is-disproportionate case
 * the issue itself anticipated. This scanner still reads `)` as division (the pre-#143
 * behaviour, unchanged), which is wrong for the `if (x) /y/` shape and right for the
 * ordinary-call shape it is far more likely to actually meet. `strip-code-comments.test.mjs`
 * pins this specific residual behaviour so a future change does not silently regress it
 * further without a reader noticing.
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

/**
 * Keywords after which a `/` starts a regex literal rather than a division — issue #143.
 * `previousMeaningful` alone only sees the single character before the `/`, so
 * `return /['"]/.test(x)` looked the same as `n /['"]/` (an identifier ending in `n`, then
 * division): the previous character was a word character either way, and no word character
 * is in `REGEX_ALLOWED_BEFORE`, so the `/` was read as division and the `'` right after it
 * was read as a STRING OPEN — which then swallows the rest of the line, including any real
 * code sitting after it (`it.skip(` included). Reproduced directly: `function f(x) { return
 * /['"]/.test(x); it.skip("real", fn); }` stripped to `... return /['` with everything after
 * gone. These are the keywords a real tokenizer also special-cases for exactly this reason
 * (Acorn, Esprima): each one is followed by the START of an expression, never a value a `/`
 * could divide.
 */
/**
 * Opus security review of #143's first fix: `of` is a CONTEXTUAL keyword, not reserved —
 * unlike every other entry here, it stays a legal identifier outside a `for...of` head
 * (`let of = 5; return of / 2;` is real code, `of` a plain variable, `/` genuine
 * division). Dropped entirely rather than special-cased: a regex object can't be looped
 * over, so `for (x of /re/)` fails at runtime anyway — keeping `of` bought nothing and
 * cost a real false-negative (`of / 2` misread as regex-open, which can hide later code
 * on the same or a following line depending on what closes the fake regex/string/
 * template it opens).
 */
const REGEX_ALLOWED_KEYWORDS = new Set([
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

const WORD_CHAR = /[A-Za-z0-9_$]/;

/**
 * The previous meaningful TOKEN before the current position — a whole keyword/identifier
 * run, not just the one character next to it, so `return` and an identifier ending in `n`
 * (e.g. a variable called `division`) can be told apart. Returns a single character for
 * anything that is not a word (an operator, a bracket, `\n`), unchanged from before #143.
 *
 * Opus security review, same pass as the `of` removal above: every reserved word is also
 * a legal PROPERTY NAME (`mod.default`, `o.in`, `o?.new`), and a property access is never
 * itself the start of an expression the way the bare keyword is — `mod.default / 2` is
 * division, not `default` followed by a regex. So a word immediately preceded by `.` or
 * `?.` (skipping whitespace) is reported as a `.` (a character `REGEX_ALLOWED_BEFORE`
 * does NOT contain), not as the keyword text, regardless of what the word itself spells.
 */
function previousMeaningful(out) {
  let i = out.length - 1;
  while (i >= 0 && (out[i] === " " || out[i] === "\t" || out[i] === "\r")) {
    i -= 1;
  }
  if (i < 0) return "\n";
  if (!WORD_CHAR.test(out[i])) return out[i];
  let start = i;
  while (start > 0 && WORD_CHAR.test(out[start - 1])) start -= 1;
  // `obj.default` and `obj?.default` both have `.` directly before the word start --
  // `?.`'s `?` sits one character further back and doesn't need its own check.
  if (start > 0 && out[start - 1] === ".") return ".";
  return out.slice(start, i + 1).join("");
}

/** True if `token` (as returned by `previousMeaningful`) puts a following `/` in regex position. */
function allowsRegex(token) {
  return token.length === 1
    ? REGEX_ALLOWED_BEFORE.has(token)
    : REGEX_ALLOWED_KEYWORDS.has(token);
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
    if (char === "/" && allowsRegex(previousMeaningful(out))) {
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

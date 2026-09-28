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
 * **#421 — the THIRD review-found gap in a hand-rolled CI scanner, and the same fix that
 * closed the other two (#352's `check-deps.mjs`, #255's `check-ui.mjs`): stop re-deriving
 * comment/string/regex boundaries with hand-maintained heuristics and use the real
 * TypeScript parser instead.** This file used to be a hand-written character scanner that
 * told a regex literal apart from division with a previous-token lookback and a
 * hand-maintained keyword/character allow-list (see git history for that version, kept
 * alongside its own regression tests as `preIssue143Scanner`/`braceCounted` in
 * `strip-code-comments.test.mjs` — those are the OLD algorithm, preserved only as the
 * non-vacuity control proving each fix actually fixed something). Three rounds of review
 * found real gaps in that heuristic:
 *
 *   - **the original #143 defect**: `previousMeaningful` only checked the single previous
 *     CHARACTER, so `return /['"]/` (a real regex right after a keyword) read the same as
 *     an identifier ending in a word character followed by division.
 *   - **`of` as a contextual keyword**: unlike every other entry in the keyword allow-list,
 *     `of` is also a legal plain identifier (`let of = 5; return of / 2;`), so keeping it in
 *     the allow-list traded one false negative for another.
 *   - **every keyword is also a legal property name**: `mod.default`, `o.in`, `o?.new`,
 *     `this.#default` are all real code where the reserved word is a property/field name,
 *     not the keyword, and `mod.default / 2` is division, not `default` opening a regex.
 *
 * Each was a narrower instance of the same class: a hand-rolled lookback re-deriving what a
 * real parser already knows for free. **Disclosed and deliberately NOT fixed by the old
 * version**: a `)` that closes an `if`/`while`/`for`/`switch` condition also puts a
 * following `/` in regex position (`if (x) /y/.test(z)` is legal), but a `)` closing an
 * ordinary call or grouped expression puts it in division position (`f(x) /y/` divides
 * `f(x)` by `y`, twice) — telling those apart from a previous-token lookback needs real
 * paren-matching back to whichever keyword (if any) opened the matching `(`, which is
 * exactly the point where a hand-rolled lookback stops being proportionate and a real
 * parser is the right tool. This rewrite uses one, so that gap closes too, structurally,
 * rather than becoming a fourth instance-patch (see `strip-code-comments.test.mjs`'s
 * "issue #143 — disclosed gap" describe block, which now asserts the CORRECT reading
 * instead of pinning the old limitation).
 *
 * **The mechanism**: parse the source with the same real TypeScript parser this repo
 * already uses for exactly this class of problem in `check-deps.mjs` and `check-ui.mjs`
 * (`typescript/unstable/ast` via `typescript/unstable/sync`'s `API` — see those files' own
 * headers for the established pattern), walk the parsed tree, and collect the exact
 * source ranges of every string literal, template head/middle/tail/no-substitution
 * literal, and regular-expression literal — node kinds the real parser already
 * distinguishes correctly from each other and from ordinary code, using real grammar
 * (paren-matching, contextual keywords, and all), not a lookback heuristic. A REGEX literal
 * is never touched (real code); a STRING/TEMPLATE literal's content is optionally blanked
 * (`blankStrings`, unchanged contract — see below). Comments are not represented as nodes
 * in the parsed tree at all (they are trivia the parser discards), so they don't need
 * AST-level detection: `//` and `/*` are UNCONDITIONALLY comment openers in real JS/TS
 * grammar with no ambiguity ever — a regex can never legally start with `//` (that is
 * always lexed as a line comment, the classic `1//2` gotcha) and `/*` can never be a real
 * division-then-multiplication (there is no valid unary-`*` expression for it to apply
 * to). So once the literal ranges above are known and skipped over verbatim, a plain
 * linear scan for `//`/`/*` in whatever text is LEFT over is exactly right — no separate
 * "is this actually a comment" judgment call remains to get wrong. This is what makes the
 * whole bug class close by construction rather than needing yet another special case: the
 * one genuinely hard judgment call (regex vs. division) is answered by the same real
 * parser that already has to answer it correctly to produce a parseable program at all,
 * and everything downstream of that (finding comments) is unambiguous.
 *
 * **The contract, preserved from before this rewrite in every respect that matters to its
 * callers** (byte offsets stay CLOSE, not necessarily identical, and reported LINE NUMBERS
 * stay meaningful — this is the load-bearing property `check:skips`/`check:events` depend
 * on, not exact byte-length preservation): a line comment collapses to a single space; a
 * block comment collapses to a single space for its opener, with any embedded newlines
 * kept (so line counts survive) and everything else — including its own closer — dropped;
 * with `{ blankStrings: true }`, a string/template literal's DELIMITERS are kept and its
 * CONTENT is blanked one character per character, which IS exact-length-preserving for
 * that literal; a regex literal is never touched, ever, regardless of `blankStrings`. **One
 * disclosed, deliberate improvement, not strictly "unchanged" (ordinary review finding,
 * #421):** a real embedded newline inside a STRING (not just a template) — a
 * backslash-newline line continuation, valid and rare in an ordinary quoted string — is
 * now preserved as a real newline. The old `readString` blanked every backslash-escape
 * PAIR to two spaces unconditionally under `blankStrings`, including when the escaped
 * character was this newline, so a multi-line string with a line continuation used to
 * silently undercount every line after it; this version has no escape-pair concept at all
 * and just checks the raw character, which happens to get this right instead. See
 * `strip-code-comments.test.mjs`'s dedicated regression test for this.
 *
 * **Public signature is unchanged**: `stripCodeComments(source, options)` still takes a
 * plain string and returns a plain string, synchronously — `check:skips`, `check:events`,
 * and `workflow-alias-table.test.mjs` all call it exactly as before with no changes needed
 * on their end. Internally, this now needs a real (synchronous) parse per call, which needs
 * a file on disk — `typescript/unstable/sync`'s `API` parses files, not in-memory strings,
 * the same restriction `check-ui.mjs`'s `parseAdHoc`/`env-reads.mjs`'s
 * `parseAdHocSourceFile` already work around for their own ad-hoc/test parsing. Reusing
 * ONE `API` instance (a real child compiler process) for the life of this module, and
 * giving it a FRESH file path on every call rather than rewriting one shared path, is not
 * an arbitrary choice: rewriting and re-`updateSnapshot`-ing the SAME path was tried first
 * and reproduced real staleness — a later call could see an EARLIER call's literal ranges
 * (`updateSnapshot` treats a re-opened path as already open and does not reliably reparse
 * it from the new disk content, even with a `fileChanges` hint) — so a new path is used
 * every time instead of chasing the right cache-invalidation incantation for a reused one.
 * `closeFiles` releases the previous call's file once its own data has been read, so open
 * files don't accumulate for the life of a long-running CI process scanning hundreds of
 * them one at a time. Measured: ~2ms/call once the API is warm (a fresh `API` instance per
 * call, the naive alternative, costs ~40ms/call — the child-process spawn, not the parse,
 * is what dominates, which is exactly what a single shared instance amortizes away).
 *
 * **Every source is parsed as `.tsx`**, regardless of the real file's own extension —
 * this function only ever receives a bare string, never a file name, so there is no
 * extension to parse it AS. JSX parsing is a strict superset of ordinary TS/JS syntax
 * except for one shape: the legacy angle-bracket type assertion (`<Type>expr`), which reads
 * as a JSX opening tag instead when JSX is enabled. This is the same accepted, documented
 * limitation `env-reads.mjs`'s own `parseAdHocSourceFile` already carries for its ad-hoc
 * parsing (see that function's comment) — real files in this repository do not use that
 * legacy cast form (this repo's own established convention is `as`/`satisfies`), so this
 * is a theoretical limitation, not an observed detection gap.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/** Node kinds whose source range is comment/string/regex-adjacent content this function
 * cares about — everything else is left as plain code, untouched either way. */
const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

/** How many characters at the START and END of each literal kind's own token text are
 * structural delimiters (kept as-is) rather than content (blanked under `blankStrings`).
 * A `StringLiteral`'s quote is 1 character (`"`/`'`, whichever the parser matched); a
 * template part's `` ` `` or `}`/`${` are always exactly these widths by grammar,
 * regardless of what the literal's content happens to contain (an escaped `\${` inside a
 * `TemplateHead` never confuses this, because the PARSER already resolved where the token
 * really ends before this file ever sees it). */
const DELIM_WIDTH = {
  [ts.SyntaxKind.TemplateHead]: [1, 2], // ` ... ${
  [ts.SyntaxKind.TemplateMiddle]: [1, 2], // } ... ${
  [ts.SyntaxKind.TemplateTail]: [1, 1], // } ... `
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: [1, 1], // ` ... `
  [ts.SyntaxKind.StringLiteral]: [1, 1], // " ... " (or ')
};

let singleton = null;

/** One long-lived `API` instance (a real child TypeScript-compiler process) for the life of
 * this module — see the file header for why a fresh instance per call is ~20x slower and
 * a fresh instance is not actually needed once a fresh FILE PATH is used per call instead. */
function getApiState() {
  if (!singleton) {
    const dir = mkdtempSync(path.join(tmpdir(), "strip-code-comments-"));
    const api = new API({ cwd: dir });
    singleton = { api, dir, counter: 0, previousFile: undefined };
    process.on("exit", () => {
      try {
        singleton.api.close();
      } catch {
        // best-effort cleanup only; the process is exiting either way
      }
      try {
        rmSync(singleton.dir, { recursive: true, force: true });
      } catch {
        // same
      }
    });
  }
  return singleton;
}

/**
 * Parse `source` with the real TypeScript parser and return the exact source ranges of
 * every string/template/regex literal in it, sorted by start position. See the file
 * header for why every call gets a brand-new file path rather than reusing one.
 *
 * @param {string} source
 * @returns {{ kind: number, start: number, end: number }[]}
 */
function parseLiteralRanges(source) {
  const state = getApiState();
  const file = path.join(state.dir, `f${state.counter}.tsx`);
  state.counter += 1;
  writeFileSync(file, source);
  const snapshot = state.api.updateSnapshot({
    openFiles: [file],
    closeFiles: state.previousFile ? [state.previousFile] : undefined,
  });
  // `closeFiles` above only releases the API's own in-memory reference; the scratch file
  // on disk is ours to remove once the API no longer needs it (ordinary review finding,
  // #421) — otherwise a long CI run scanning hundreds of files leaves hundreds of small
  // leftover files until process exit's directory-wide cleanup.
  if (state.previousFile) {
    try {
      rmSync(state.previousFile, { force: true });
    } catch {
      // best-effort only; the exit handler's directory-wide cleanup still catches this
    }
  }
  state.previousFile = file;
  try {
    const project = snapshot.getDefaultProjectForFile(file);
    const sourceFile = project?.program.getSourceFile(file);
    // Fail CLOSED, not open (ordinary review finding, #421): a real parser failure here
    // (a project/path resolution problem, never actual malformed JS/TS content — the real
    // parser's own error recovery already produces a best-effort tree for every malformed
    // input this file was tested against, unterminated strings/templates/regexes and pure
    // garbage included) must not silently degrade to "no literal ranges at all", which
    // would be a WORSE failure mode than the scanner this file replaced: a `//` sitting
    // inside an actual string literal would then misread as a real comment. Throwing
    // matches this repo's own established convention for this class of gate (check-events.mjs's
    // own header: "fails CLOSED, never silently, on a call it cannot read").
    if (!sourceFile) {
      throw new Error(
        "stripCodeComments: the real TypeScript parser produced no source file for a " +
          `${source.length}-character input via a fresh scratch path (${file}) — refusing ` +
          "to fall back to zero literal-range awareness, which would silently treat every " +
          "string/template/regex boundary in this input as ordinary code.",
      );
    }
    const ranges = [];
    (function visit(node) {
      if (LITERAL_KINDS.has(node.kind)) {
        ranges.push({
          kind: node.kind,
          start: node.getStart(sourceFile),
          end: node.end,
        });
      }
      node.forEachChild(visit);
    })(sourceFile);
    ranges.sort((a, b) => a.start - b.start);
    return ranges;
  } finally {
    snapshot.dispose();
  }
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
  const ranges = parseLiteralRanges(source);
  const out = [];
  let i = 0;
  let r = 0;

  while (i < source.length) {
    // ── a string / template / regex literal, exactly where the real parser found one ──
    if (r < ranges.length && ranges[r].start === i) {
      const { kind, end } = ranges[r];
      r += 1;

      const [leadWidth, tailWidth] = DELIM_WIDTH[kind] ?? [0, 0];
      if (
        kind === ts.SyntaxKind.RegularExpressionLiteral ||
        !blankStrings ||
        end - i < leadWidth + tailWidth
      ) {
        // Regex content is real code and is never blanked; when `blankStrings` is off,
        // string/template content is left alone too — only comments come out. A range
        // narrower than its own delimiters only happens for a zero-width synthetic token
        // the parser inserts during error recovery on truncated input (an unterminated
        // template's missing closing tail, start === end) — there is no real delimiter to
        // keep separate from content there, so it is left exactly as found (a no-op for a
        // genuinely empty range).
        out.push(source.slice(i, end));
        i = end;
        continue;
      }

      out.push(source.slice(i, i + leadWidth));
      for (let k = i + leadWidth; k < end - tailWidth; k += 1) {
        out.push(source[k] === "\n" ? "\n" : " ");
      }
      out.push(source.slice(end - tailWidth, end));
      i = end;
      continue;
    }

    // ── everything else: comments are unambiguous once literals are excluded ──────────
    const char = source[i];
    const next = source[i + 1];

    // line comment — collapsed to one space; the terminating `\n` (if any) is pushed
    // verbatim by the catch-all below on the next iteration, so line counts survive.
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out.push(" ");
      continue;
    }

    // block comment — one space for the opener, embedded newlines kept so line numbers
    // survive, everything else (including the closer) dropped, same as a line comment.
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

    out.push(char);
    i += 1;
  }

  return out.join("");
}

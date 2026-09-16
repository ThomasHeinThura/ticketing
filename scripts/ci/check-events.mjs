#!/usr/bin/env node
/**
 * check:events — every event key `publishEvent(...)` can actually emit is named in
 * docs/01-architecture/events.md.
 *
 * Issue #86: the API published 20 keys in the inherited kaneo vocabulary (`task.*`,
 * `comment.*`, …) while events.md declared 40 keys in the target `work_item.*` / `sla.*` /
 * `approval.*` vocabulary — zero overlap, because nothing had ever compared the two. This
 * is that comparison, made permanent. Both sides are DERIVED, never hand-maintained:
 *
 *   published  every literal string `publishEvent(...)` can be called with, found by
 *              scanning apps/api/src (see extractPublishedKeys below)
 *   declared   every backticked, dot-namespaced identifier events.md names — in the
 *              current-canon Catalogue, or in its "Inherited compatibility vocabulary"
 *              section, either counts
 *
 * A hand-written duplicate list is the exact defect this repository keeps reproducing —
 * #81 was a whole pull request fixing one instance of it. So when a `publishEvent(...)`
 * call's argument is not a plain string literal, this FAILS CLOSED (throws) rather than
 * skipping it: a checker that skips what it cannot read is how #79's uncovered reach
 * stayed hidden. The one shape this repository actually uses beyond a bare literal — a
 * local `const NAME = cond ? "a" : "b"` immediately consumed by `publishEvent(NAME, …)` —
 * is resolved rather than skipped; anything else is unresolvable and the run refuses to
 * pass silently.
 *
 * **Disclosed limits, so a reader does not have to assume more coverage than exists:**
 *
 *   SURFACE   Only `apps/api/src` is scanned (`SOURCE_ROOTS` below), and `walk()` in
 *             `./lib/repo.mjs` additionally skips symlinks and its own
 *             `ignoredDirectories` (`build`/`dist`/`out`, among others) and
 *             `generatedFiles` (`routeTree.gen.ts`). Today that surface is ACCURATE:
 *             `grep -rln publishEvent --include=*.ts` outside `apps/api/src` (excluding
 *             `node_modules`, this script and its tests) returns nothing. It is NOT
 *             future-proof — the `work_item.*` migration `events.md` already names implies
 *             a future publisher living in `packages/domain`, which would sit outside this
 *             root and go undetected. Widen `SOURCE_ROOTS` when that publisher exists,
 *             rather than assuming this comment still describes reality.
 *   DECLARED  `declaredKeys()` is a WHOLE-DOCUMENT prose scrape, not a parse of a specific
 *             section: any backticked, lowercase, dot-namespaced token anywhere in
 *             events.md counts as "declared", including a field or column name the
 *             document happens to backtick that is not an event key at all. Measured on
 *             the tree today, SIX tokens are publishable this way, not four:
 *             `actor.type`, `outbox.kind`, `approval.state` and
 *             `notification_preference.event_kind` are field/column names; worse,
 *             `mention.in_comment` and `work_item.field_changed` are event-key-shaped
 *             names events.md backticks only to DISOWN — the former as the retired
 *             predecessor `work_item.mentioned` replaced, the latter in bold as "not a
 *             key; it is `work_item.updated` with a condition on `changes[].field`". A
 *             `publishEvent(...)` call using any of these six names would pass this check
 *             without ever being genuinely registered as an event (round 1's LOW 8,
 *             unfixed). The fix is a section-scoped parse — the current-canon Catalogue
 *             and the inherited-compatibility section only — rather than a whole-file
 *             scrape; not done, because it needs a name collision to matter and the
 *             DIRECTION accounting below already reports every orphan declaration.
 *   DIRECTION Only the forward direction is checked: every PUBLISHED key must be
 *             DECLARED. A key `events.md` declares that nothing publishes is never
 *             reported — deliberately, not an oversight. `events.md` names the
 *             forward-looking `work_item.*` / `sla.*` / `approval.*` target vocabulary
 *             #86 exists to migrate toward (47 such orphan declarations at the time of
 *             writing), so a reverse check would be red from day one on keys nothing has
 *             built yet. The success line below reports only the direction actually
 *             checked; it is not a two-way reconciliation.
 *   CALL      `publishedKeysIn` recognises, WITHIN ONE FILE: a direct call, a space before
 *             the paren (`publishEvent (…)`), a single level of generic type arguments
 *             (`publishEvent<T>(…)`), an aliased import (`import { publishEvent as X }`),
 *             and a local const alias (`const X = publishEvent;`, transitively through a
 *             chain of such aliases). Comments are blanked before any of this is scanned,
 *             so a comment can never fake a declaration or a call site. A shape this
 *             extractor does not specifically recognise as one of those — optional
 *             chaining, a namespace-qualified call, a generic argument nested two levels
 *             deep, a bare reference passed as a callback, and more — is not silently
 *             invisible either: a residual scan (bottom of `publishedKeysIn`) fails the
 *             run on any bare occurrence of a tracked name that sits outside a recognised
 *             call, import, or alias declaration, rather than reporting the file as though
 *             the usage does not exist. A checker that cannot understand a shape refuses
 *             to guess "0 keys" — but only within the one file it is reading.
 *
 *             A CROSS-FILE alias IS silently invisible, and this is a real gap, not a case
 *             the residual scan covers. `names` — the set of identifiers this extractor
 *             treats as `publishEvent` — is computed separately PER FILE, from that file's
 *             own text (`callNamesIn`), and `main()` only ever opens a file whose own text
 *             contains the literal identifier `publishEvent`. A file that does
 *             `export const emit = publishEvent;` (or `export { publishEvent as emit }`,
 *             or a multi-hop re-export chain through an index module) and a SEPARATE
 *             consuming file that only ever imports and calls `emit` never spells
 *             `publishEvent` in its own text, so that consuming file is never opened and
 *             its call is never seen — the residual scan cannot fail closed on a file the
 *             pre-filter never let it read. Such a call reports "0 published event key(s)"
 *             for that file, silently (review PR #91, round 2, MEDIUM 3). There is no
 *             mitigation today: a publisher of a NEW key must `import { publishEvent }`
 *             directly, or alias it in the SAME file as the call site, for this checker to
 *             see it. Closing this properly means a first pass that resolves import
 *             specifiers to files and builds a repo-wide alias set before the per-file
 *             scan runs — real, undone work, not a one-line fix — and no such cross-file
 *             indirection exists in the tree today (`grep -rn "= publishEvent\s*;\|publishEvent as "
 *             apps/` finds none); this comment is a disclosure of a gap, not a promise it
 *             never will.
 *
 * Usage:
 *   node scripts/ci/check-events.mjs
 */

import path from "node:path";
import {
  codeFilesUnder,
  finish,
  readText,
  rel,
  repoRoot,
  violation,
} from "./lib/repo.mjs";
import { stripCodeComments } from "./lib/strip-code-comments.mjs";

const NAME = "check:events";
const SOURCE_ROOTS = ["apps/api/src"];
const AUTHORITY = "docs/01-architecture/events.md";

/** A TaskDesk or kaneo event key: lowercase, dot-namespaced, segments may use `-`/`_`. */
const KEY_SHAPE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

function isEventKeyShaped(text) {
  return KEY_SHAPE.test(text);
}

/**
 * Every backticked, event-key-shaped identifier named anywhere in the authority document —
 * the current Catalogue and the inherited compatibility section both count as "declared".
 */
async function declaredKeys() {
  const source = await readText(path.join(repoRoot, AUTHORITY));
  const names = new Set();
  for (const match of source.matchAll(/`([a-zA-Z0-9_.-]+)`/g)) {
    if (isEventKeyShaped(match[1])) {
      names.add(match[1]);
    }
  }
  if (names.size === 0) {
    throw new Error(`No event keys parsed from ${AUTHORITY}; refusing to run.`);
  }
  return names;
}

/**
 * Scan from `start` (the character right after `publishEvent(`) for the call's first
 * argument, respecting string/template quoting and nested `( [ {` so a comma or a
 * paren *inside* a nested structure is not mistaken for the argument's end.
 *
 * @returns {{text: string, end: number}} the raw, untrimmed-of-surrounding-code argument
 *   text and the index just past it (at the terminating `,` or the call's closing `)`).
 */
function scanFirstArgument(source, start) {
  let i = start;
  let depth = 0;
  let quote = null;

  while (i < source.length) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === "," && depth === 0) break;
    i += 1;
  }

  return { text: source.slice(start, i).trim(), end: i };
}

/**
 * If `text` is a complete, non-interpolated string literal (`"…"`, `'…'` or a backtick
 * literal with no `${`), its unquoted body. Otherwise `null` — including a `${…}`
 * template, which this extractor cannot resolve statically.
 */
function literalBody(text) {
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text[text.length - 1] !== quote) return null;
  const body = text.slice(1, -1);
  if (quote === "`" && body.includes("${")) return null;
  return body;
}

/**
 * Resolve a local `const NAME = <expr>;` to the string literal(s) it can hold. Supports a
 * bare literal and a ternary between two literals — the only non-literal shape this
 * codebase's `publishEvent(...)` call sites use (`bulk-update-tasks.ts`'s
 * `const eventType = assigneeId ? "task.assignee_changed" : "task.unassigned"`). Returns
 * `null` when unresolvable, so the caller can fail closed rather than guess.
 *
 * The declaration search runs over `structural` (comments AND string CONTENTS blanked),
 * never `code` (string contents intact) — a decoy `const NAME = "…";` written as the VALUE
 * of an unrelated string constant (`export const SNIPPET = "const eventType = " +
 * "'task.created';"`, say) is real text in `code` but disappears entirely from
 * `structural`, so it can never be mistaken for a declaration (security review, PR #91
 * round 5, HIGH). The matched RHS is then read back out of `code` at the SAME byte
 * offsets: `structural` and `code` are guaranteed to be the same length, with every
 * character outside a string/template literal at the same offset in both, because both
 * are produced by the one `stripCodeComments` pass and differ only in that pass's
 * `blankStrings` option, which substitutes each string-content character for exactly one
 * space rather than deleting or inserting anything. `structural`'s capture-group indices
 * (the `d` flag) therefore point at the real value in `code` directly — no re-scan, and no
 * risk of the two texts drifting apart.
 *
 * This still has NO scope analysis of its own — it is a flat regex over the whole file's
 * text, so it cannot tell a function-local `const kind` from an unrelated, same-named
 * `const kind` in a different function elsewhere in the file. Picking the first match
 * regardless used to resolve a call to the WRONG declaration's value: a second
 * `const kind = "…"` later in the file made its own `publishEvent(kind, …)` invisible
 * while the run printed a confident "every one registered" — answering wrongly rather than
 * throwing or skipping, which contradicts this file's own fail-closed promise. So every
 * `const NAME = …;` in the file is collected, and more than one is refused outright rather
 * than guessed at: rename one of the declarations, or give this call site a literal.
 *
 * Nor does finding exactly one `const NAME = …;` prove the call site actually reads THAT
 * binding: `name` matching this call's argument text says nothing about which binding is
 * in scope there, and a `let`/`var NAME` or a function PARAMETER named `NAME` can shadow
 * the const at the call site while this regex-only search stays oblivious to either
 * (security review, PR #91 round 5, HIGH — same root cause as the decoy-string case above:
 * no scope analysis). So once the one legitimate declaration is found,
 * `assertNoOtherBinding` below demands that EVERY occurrence of `name` anywhere in the
 * file is either inside that declaration's own span or is the argument of a recognised
 * `publishEvent`-shaped call — a `let`/`var NAME`, a parameter, or any other occurrence
 * fails that positive check and throws, because none of those can be attributed to the one
 * const this function found.
 */
function resolveLocalConst(code, structural, callNames, name, location) {
  const declarationPattern = new RegExp(
    `const\\s+${name}\\s*=\\s*([^;]+);`,
    "gd",
  );
  const declarations = [...structural.matchAll(declarationPattern)];
  if (declarations.length === 0) return null;
  if (declarations.length > 1) {
    throw new Error(
      `${location}: publishEvent(${name}, …) cannot be resolved with confidence — "${name}" ` +
        `has ${declarations.length} \`const ${name} = …;\` declarations in this file, and ` +
        "the extractor has no scope analysis to tell which one this call site means. " +
        "Resolving to whichever came first answered a DIFFERENT call's key wrongly rather " +
        "than failing, in exactly the shape this repository's checkers exist to refuse. " +
        "Rename one of the declarations so each name is unique in the file, or replace " +
        "this call's argument with a literal.",
    );
  }
  const [declaration] = declarations;
  const [declarationStart, declarationEnd] = declaration.indices[0];
  const [rhsStart, rhsEnd] = declaration.indices[1];

  assertNoOtherBinding(
    structural,
    callNames,
    name,
    declarationStart,
    declarationEnd,
    location,
  );

  const rhs = code.slice(rhsStart, rhsEnd).trim();

  const bare = literalBody(rhs);
  if (bare !== null) return [bare];

  const ternary = rhs.match(/^[\s\S]*?\?\s*([\s\S]+?)\s*:\s*([\s\S]+)$/);
  if (ternary) {
    const whenTrue = literalBody(ternary[1].trim());
    const whenFalse = literalBody(ternary[2].trim());
    if (whenTrue !== null && whenFalse !== null) {
      return [whenTrue, whenFalse];
    }
  }

  return null;
}

/** Escape a string for literal use inside a `RegExp(...)` constructor. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every identifier in this file that the review's HIGH 4 named as an invisible call
 * shape can bind to the real `publishEvent` — the function itself, an import alias
 * (`import { publishEvent as emit }`, case H), and a local const alias
 * (`const emit = publishEvent;`, case L), resolved transitively so a chain of aliases
 * (`const b = a; const c = b;`) all trace back. Deliberately permissive about the
 * import's source module — any `publishEvent as X` counts, regardless of where `X` is
 * imported from — because the cost of a false alias is a spurious report to fix by
 * renaming, never a silent miss, and that is the direction this extractor is willing to
 * err in.
 *
 * Also returns `explainedSpans`: source ranges (over the SAME `blankStrings: true`
 * source `names` was computed from) that already account for a bare occurrence of one of
 * these names — an import specifier or an alias declaration — so the residual scan in
 * `publishedKeysIn` does not mistake either for an unrecognised usage.
 */
function callNamesIn(structural) {
  const names = new Set(["publishEvent"]);
  const explainedSpans = [];

  for (const match of structural.matchAll(
    /\bpublishEvent\s+as\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
    explainedSpans.push([match.index, match.index + match[0].length]);
  }

  // A plain `import { publishEvent, … } from "…";` (no alias) still spells `publishEvent`
  // inside the specifier list — explain the whole clause so that bare mention is not
  // read as an unrecognised usage.
  for (const match of structural.matchAll(
    /import\s*\{[^}]*\}\s*from\s*["'][^"']*["']\s*;?/g,
  )) {
    explainedSpans.push([match.index, match.index + match[0].length]);
  }

  // `const ALIAS = NAME;` for every name known so far, to a fixed point.
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of [...names]) {
      const pattern = new RegExp(
        `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegExp(name)}\\s*;`,
        "g",
      );
      for (const match of structural.matchAll(pattern)) {
        explainedSpans.push([match.index, match.index + match[0].length]);
        if (!names.has(match[1])) {
          names.add(match[1]);
          grew = true;
        }
      }
    }
  }

  return { names, explainedSpans };
}

/** One level of nested `<...>`, so `publishEvent<T>(` and `publishEvent<Foo<Bar>>(` both
 * match — case K. Two or more nested levels are NOT matched on purpose: the residual
 * scan in `publishedKeysIn` fails the run on that shape rather than silently missing it. */
const GENERIC_ARGS = "(?:<(?:[^<>]|<[^<>]*>)*>)?";

/** Every tracked name, followed by optional whitespace, an optional generic argument
 * list, optional whitespace, then `(` — case I (space before the paren) and case K
 * (generic type argument) both fall out of the same tolerant shape. */
function buildCallRegex(names) {
  const alternatives = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`\\b(${alternatives})\\b\\s*${GENERIC_ARGS}\\s*\\(`, "g");
}

/**
 * Refuse when `name` is bound to anything other than the one legitimate declaration at
 * [`declarationStart`, `declarationEnd`) — a same-named `let`/`var`, a function parameter,
 * or any other occurrence this flat-regex extractor cannot attribute to that const
 * (security review, PR #91 round 5, HIGH). Rejecting only a sibling `let NAME`/`var NAME`
 * would still miss a function PARAMETER of the same name — a parameter binding has no
 * `const`/`let`/`var` keyword at all, so it can never match that shape. This instead
 * verifies the positive, stricter condition: every occurrence of `name` anywhere in the
 * file must be either inside the declaration span or the argument of a call this file
 * already recognises as `publishEvent`-shaped (`buildCallRegex(callNames)` — the same
 * pattern `publishedKeysIn` uses to find call sites). A `let`/`var` binding and a
 * parameter binding both fail this the same way, because neither is the declaration and
 * neither is a recognised call's argument.
 *
 * This can over-refuse a same-named identifier used elsewhere in the file for an entirely
 * unrelated, harmless purpose (a different, block-scoped `eventType` that never reaches
 * `publishEvent` at all, say) — deliberately: this extractor has no scope analysis to tell
 * that case apart from real shadowing either, and the whole point of this file is to
 * refuse guessing through an ambiguity like that rather than resolve it silently. Rename
 * the unrelated identifier, or give the call site a literal.
 */
function assertNoOtherBinding(
  structural,
  callNames,
  name,
  declarationStart,
  declarationEnd,
  location,
) {
  const legitimateCallArgument = new RegExp(
    `\\b(?:${[...callNames]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})\\b\\s*${GENERIC_ARGS}\\s*\\(\\s*(${escapeRegExp(name)})\\b`,
    "gd",
  );
  const legitimateSpans = [[declarationStart, declarationEnd]];
  for (const match of structural.matchAll(legitimateCallArgument)) {
    legitimateSpans.push(match.indices[1]);
  }

  for (const match of structural.matchAll(
    new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"),
  )) {
    const at = match.index;
    if (legitimateSpans.some(([start, end]) => at >= start && at < end)) {
      continue;
    }
    throw new Error(
      `${location}: publishEvent(${name}, …) cannot be resolved with confidence — "${name}" ` +
        "is bound some other way as well (a `let`/`var` of the same name, a function " +
        "parameter, or another occurrence this extractor cannot attribute to the one " +
        `\`const ${name} = …;\` declaration it found), near ` +
        `${JSON.stringify(structural.slice(Math.max(0, at - 20), Math.min(structural.length, at + 20)))}. ` +
        "Resolving anyway risks reading a shadowed binding's value instead of the const's, " +
        "which is exactly the ambiguity this checker refuses to guess through. Rename the " +
        "shadowing identifier, or give this call's argument a literal.",
    );
  }
}

/**
 * Every event key one file's `publishEvent(...)` calls (and its aliases) can publish.
 * Throws — fails closed — the moment a call's argument cannot be resolved to one or more
 * string literals, OR a tracked name is used in a shape this extractor does not
 * recognise as a call, an import, or an alias declaration.
 */
function publishedKeysIn(rawSource, location) {
  // Comments blanked (replaced with same-length whitespace, newlines kept) BEFORE any
  // scan runs, so a comment can never fake a declaration or a call site — case J was
  // exactly a comment ending in the word `function` disabling the declaration-site skip
  // for the real call sitting beneath it.
  const code = stripCodeComments(rawSource);
  // A second copy with string CONTENTS also blanked, used only to decide whether a bare
  // identifier occurrence is real code — an import, an alias, an unrecognised usage — or
  // sits inside a string literal (example source embedded as test/doc fixture text does
  // not execute and must not be read as a real call).
  const structural = stripCodeComments(rawSource, { blankStrings: true });

  const { names, explainedSpans } = callNamesIn(structural);
  const callRegex = buildCallRegex(names);
  const keys = new Set();
  const callSpans = [];

  for (const match of structural.matchAll(callRegex)) {
    const name = match[1];
    const callAt = match.index;
    callSpans.push([callAt, callAt + match[0].length]);

    // The declaration site (`export async function publishEvent(eventType: string, …)` in
    // events/index.ts) matches the same shape and is not a call — skip it. Restricted to
    // the canonical name: an alias is only ever produced by an import or a const
    // assignment, never a function declaration, so this cannot fire for one.
    if (
      name === "publishEvent" &&
      /\bfunction\s*\*?\s*$/.test(
        structural.slice(Math.max(0, callAt - 40), callAt),
      )
    ) {
      continue;
    }

    const argStart = callAt + match[0].length;
    const { text: rawArgument } = scanFirstArgument(code, argStart);

    const literal = literalBody(rawArgument);
    const resolved =
      literal !== null
        ? [literal]
        : /^[A-Za-z_$][\w$]*$/.test(rawArgument)
          ? resolveLocalConst(code, structural, names, rawArgument, location)
          : null;

    if (resolved === null) {
      throw new Error(
        // JSON.stringify rather than raw interpolation: `rawArgument` is arbitrary source
        // text, and GitHub Actions parses `::error::`-style workflow commands out of a
        // step's own stderr. Escaping quotes and collapsing any embedded newline onto one
        // line keeps a crafted argument from landing a fake annotation in the job log.
        `${location}: publishEvent(${JSON.stringify(rawArgument)}, …) does not pass a ` +
          "plain string literal, and no resolvable local `const` assignment was found for " +
          "it either. The extractor cannot determine which key(s) this call publishes and " +
          "refuses to guess or skip it (that is how #79's uncovered reach stayed hidden) — " +
          "resolve it to a literal, or extend resolveLocalConst/literalBody in " +
          "scripts/ci/check-events.mjs to understand this shape.",
      );
    }

    for (const key of resolved) {
      if (!isEventKeyShaped(key)) {
        // JSON.stringify here too: `key` has NOT yet passed isEventKeyShaped at this
        // point (that is what this branch is reporting the failure of), and a plain
        // backtick literal with no `${` can carry arbitrary text — including embedded
        // newlines — straight through `literalBody`, unlike the already-validated `key`
        // used in the "not named in events.md" violation message below.
        throw new Error(
          `${location}: publishEvent(…) can publish ${JSON.stringify(key)}, which is not ` +
            "shaped like a lowercase, dot-namespaced event key. The extractor refuses to " +
            "guess whether this is a real event key or something else — check the call site.",
        );
      }
      keys.add(key);
    }
  }

  // Fail-closed residual scan: any bare occurrence of a tracked name — canonical or an
  // alias — that sits outside a recognised call (callSpans, the declaration included), an
  // import specifier, or a const-alias declaration is a shape this extractor does not
  // understand. Reporting the file as though that usage does not exist would be exactly
  // the "0 published event key(s)" silent-green defect this file exists to prevent, so it
  // refuses to run instead. This is what closes shapes beyond the five the review named
  // explicitly by construction — optional chaining (`publishEvent?.(`), a
  // namespace-qualified call (`Events.publishEvent(`), the bare function passed as a
  // callback, and a generic argument nested two levels deep all land here.
  const explained = [...callSpans, ...explainedSpans];
  for (const name of names) {
    for (const match of structural.matchAll(
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"),
    )) {
      const at = match.index;
      if (explained.some(([start, end]) => at >= start && at < end)) continue;
      throw new Error(
        `${location}: "${name}" is used in a shape this extractor does not recognise as ` +
          "a call, an import, or a local alias assignment (near " +
          `${JSON.stringify(structural.slice(Math.max(0, at - 20), Math.min(structural.length, at + 20)))}). ` +
          "It refuses to report this file as though that usage does not exist — extend " +
          "scripts/ci/check-events.mjs to understand this shape, or rewrite the call to a " +
          "form the extractor recognises (a direct call, or a `const ALIAS = publishEvent;` " +
          "assignment).",
      );
    }
  }

  return keys;
}

async function main() {
  const declared = await declaredKeys();
  const failures = [];
  /** @type {Map<string, Set<string>>} */
  const published = new Map();

  const files = await codeFilesUnder(SOURCE_ROOTS);
  if (files.length === 0) {
    throw new Error(
      `No source files found under ${SOURCE_ROOTS.join(", ")}; refusing to run.`,
    );
  }

  for (const absolute of files) {
    const source = await readText(absolute);
    // The bare identifier, not the literal substring `publishEvent(` — an aliased import
    // (`publishEvent as emit`) or a local alias assignment (`const emit = publishEvent;`,
    // cases H and L) never spell `publishEvent(` at all, and a file containing only one
    // of those would have been skipped entirely by a stricter pre-filter.
    if (!/\bpublishEvent\b/.test(source)) continue;

    const location = rel(absolute);
    for (const key of publishedKeysIn(source, location)) {
      const locations = published.get(key) ?? new Set();
      locations.add(location);
      published.set(key, locations);
    }
  }

  for (const key of [...published.keys()].sort()) {
    if (declared.has(key)) continue;
    const locations = [...published.get(key)].sort();
    failures.push(
      violation(
        locations.join(", "),
        `publishEvent("${key}", …) is not named in ${AUTHORITY}. Add it there first, in ` +
          "the same change — as current canon in the Catalogue if the emitting code is " +
          "native, or in the inherited compatibility section if it is not " +
          "(AGENTS.md do-not 11).",
      ),
    );
  }

  finish({
    name: NAME,
    failures,
    ok: `${published.size} published event key(s) across ${files.length} source file(s), every one registered in ${AUTHORITY}`,
  });
}

await main();

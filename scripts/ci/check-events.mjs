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
 */
function resolveLocalConst(source, name) {
  const declaration = source.match(
    new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`),
  );
  if (!declaration) return null;
  const rhs = declaration[1].trim();

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

/**
 * Every event key one file's `publishEvent(...)` calls can publish. Throws — fails closed
 * — the moment a call's argument cannot be resolved to one or more string literals.
 */
function publishedKeysIn(source, location) {
  const keys = new Set();
  const callTag = "publishEvent(";
  let searchFrom = 0;

  for (;;) {
    const callAt = source.indexOf(callTag, searchFrom);
    if (callAt === -1) break;

    // The declaration site (`export async function publishEvent(eventType: string, …)` in
    // events/index.ts) matches the same tag and is not a call — skip it rather than trying
    // to resolve its parameter name as an event key.
    if (/function\s*$/.test(source.slice(Math.max(0, callAt - 40), callAt))) {
      searchFrom = callAt + callTag.length;
      continue;
    }

    const argStart = callAt + callTag.length;
    const { text: rawArgument, end } = scanFirstArgument(source, argStart);
    searchFrom = end + 1;

    const literal = literalBody(rawArgument);
    const resolved =
      literal !== null
        ? [literal]
        : /^[A-Za-z_$][\w$]*$/.test(rawArgument)
          ? resolveLocalConst(source, rawArgument)
          : null;

    if (resolved === null) {
      throw new Error(
        `${location}: publishEvent(${rawArgument}, …) does not pass a plain string ` +
          "literal, and no resolvable local `const` assignment was found for it either. " +
          "The extractor cannot determine which key(s) this call publishes and refuses " +
          "to guess or skip it (that is how #79's uncovered reach stayed hidden) — " +
          "resolve it to a literal, or extend resolveLocalConst/literalBody in " +
          "scripts/ci/check-events.mjs to understand this shape.",
      );
    }

    for (const key of resolved) {
      if (!isEventKeyShaped(key)) {
        throw new Error(
          `${location}: publishEvent(…) can publish "${key}", which is not shaped like a ` +
            "lowercase, dot-namespaced event key. The extractor refuses to guess whether " +
            "this is a real event key or something else — check the call site.",
        );
      }
      keys.add(key);
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
    if (!source.includes("publishEvent(")) continue;

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

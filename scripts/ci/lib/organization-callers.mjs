/**
 * S10 tripwire — every executable `authClient.organization.*` access in the client
 * runtime surface, derived mechanically rather than grepped.
 *
 * **Why a grep is not enough.** This project has already miscounted this exact surface
 * five times, because files carry lines like:
 *
 *   // S4b: native replacement for authClient.organization.create().
 *   // authClient.organization.list() -- GET /api/workspace.
 *
 * — prose that NAMES the method S3/S4b already replaced, in a comment. `grep -c
 * "authClient.organization"` counts these as callers. They are not: nothing executes a
 * comment. So every source file is run through `stripCodeComments` (scripts/ci/lib/
 * strip-code-comments.mjs, the repo's one hand-rolled comment/string scanner) before this
 * module looks for anything, and its `blankStrings` mode removes the second false-positive
 * class this task's own history has hit: a string literal or test fixture that CONTAINS the
 * text `authClient.organization.setActive(` is data, not a call.
 *
 * **What "the auth client" is, is derived, not named.** The only fact this module hard-codes
 * is the better-auth factory call itself — `createAuthClient(` — because that is the one
 * spelling the client can be constructed with; everything downstream (which file defines it,
 * what it is called, which files import it, what they call the binding locally) is read out
 * of the source tree. There is no list of "the N families" or "the files known to call
 * this" anywhere in this module — see `findAuthClientDefinition` and `findRootAliases`.
 *
 * ## What counts as a live call
 *
 *   authClient.organization.setActive(...)
 *   authClient?.organization?.setActive?.(...)          optional chaining, every link
 *   authClient.organization.setActive<T>(...)           generic type arguments
 *   const { organization } = authClient; organization.setActive(...)
 *   const org = authClient.organization; org.setActive(...)
 *
 * are all recognised, resolved back to a family (the method name) and a location.
 *
 * ## Fails closed, not quiet
 *
 * A shape this module cannot prove is safe is never dropped on the floor and never
 * silently counted as zero. It is collected as a **refusal** — file, line, and the shape
 * that defeated the scanner — and `check-organization-callers.mjs` turns any non-empty
 * refusal list into an unconditional failure, independent of the shrink-only ratchet below
 * it. Refused shapes, exhaustively:
 *
 *   - `import * as NS from "<the auth-client module>"` — a namespace import. Tracing
 *     `NS.authClient.organization…` would require re-deriving this whole analysis one
 *     level deeper for a shape nothing in this repository uses today.
 *   - an import clause this module's small grammar cannot parse at all.
 *   - `authClient["organization"]`, `authClient.organization["setActive"]` — computed
 *     member access. The property selected is data at scan time, so it cannot be ruled
 *     OUT as `"organization"`.
 *   - `authClient.organization.setActive` referenced WITHOUT being called (assigned,
 *     returned, passed as a bare argument, spread) — nothing proves it is not invoked
 *     somewhere this scanner cannot follow.
 *   - `authClient.organization` itself used any way other than a direct call chain or one
 *     of the two alias forms above (assigned to a plain variable without `const/let/var`,
 *     used as a bare expression, etc).
 *   - `authClient` itself (the whole client) referenced bare — passed to a function,
 *     assigned to an unrecognised variable, spread, returned — anywhere this module does
 *     not already understand as an import, a declaration, an object-literal key, or one of
 *     the two alias forms. A client re-bound under a new name could reach `.organization`
 *     by a route this module never looks at again.
 *   - malformed/unbalanced generic type arguments between a method name and its call.
 *   - a **re-export** of the auth-client module, `export { authClient } from "…"` or
 *     `export * from "…"`. A demonstrated bypass of this gate rather than a hypothetical:
 *     see `EXPORT_FROM_STATEMENT` below for the exact shape that produced a clean exit 0
 *     with a real live caller planted behind it.
 *   - a **re-export chain rooted outside the scanned root** (`apps/web/src`): an in-root
 *     import resolving to a barrel file elsewhere in the repository (or a chain of such
 *     barrels) that itself re-exports the auth client. The direct in-root case above is
 *     caught because the barrel file is itself scanned; a barrel living outside the
 *     scanned root never is, so the only place left to notice it is the in-root import
 *     that resolves to it — see `reexportsDefinitionTransitively`.
 *   - a **dynamic `import("…")`** of the auth-client module — `await import(...)`, awaited
 *     or not, destructured or member-accessed afterward in any shape. Tracing the
 *     resolved promise's value would mean re-deriving this whole alias analysis for an
 *     expression rather than a declaration; refused outright instead.
 *   - a **CommonJS `require("…")`** of the auth-client module. This module's import
 *     grammar is ESM-only (`import … from`); a `require()` of the same specifier is a
 *     different grammar this scanner does not parse, so it is refused rather than
 *     silently unmatched.
 *   - a **symlink** anywhere under the scanned root that resolves (by realpath) outside
 *     the repository. This scanner does not read content it cannot check into the same
 *     tree the gate is run against; a symlinked file or directory that resolves INSIDE
 *     the repository is instead followed like the real file/directory it names — see
 *     `collectScanFiles`.
 *   - a tsconfig whose path-alias map (`compilerOptions.paths`, followed through
 *     `extends` and `references`) cannot be found at all — see `loadPathAliases`. An
 *     alias table this scanner cannot prove is exactly the shape that would otherwise let
 *     an ordinary tsconfig refactor collapse the whole gate to a false "0 calls, 0
 *     refusals" with no error anywhere.
 *
 * None of the shapes above exists in this repository today (verified by running this
 * scanner over `apps/web/src` at HEAD), which is exactly why the gate can ship green: the
 * refusal path is armed but silent until something actually needs it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { generatedFiles, ignoredDirectories } from "./repo.mjs";
import { stripCodeComments } from "./strip-code-comments.mjs";

/** Thrown when the auth-client definition itself cannot be pinned down. Always fatal. */
export class OrganizationCallerScanUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrganizationCallerScanUnavailableError";
  }
}

const DECLARATION_KEYWORDS = new Set(["const", "let", "var"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*/;
const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 1-based line number of `index` within `text`. Never removed by comment/string stripping. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetAt(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = text.length;
  return text.slice(lineStart, lineEnd).replace(/\s+/g, " ").trim();
}

/** Nearest non-whitespace character at or before `index` (exclusive of index itself). */
function previousNonSpace(text, index) {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  return i;
}

/** Word immediately before `index` (skipping whitespace), or null. */
function precedingWord(text, index) {
  const end = previousNonSpace(text, index);
  if (end < 0) return null;
  let start = end;
  while (start >= 0 && /[\w$]/.test(text[start])) start -= 1;
  if (start === end) return null; // the char at `end` was punctuation, not a word char
  return { word: text.slice(start + 1, end + 1), charBefore: text[end] };
}

function skipWs(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

/**
 * Balanced `<...>` starting at `text[start] === "<"`. Returns the index just past the
 * matching `>`, or null when it never balances within a sane budget — read as "not
 * generics", which the caller turns into a refusal rather than a guess.
 */
function matchBalancedAngles(text, start) {
  // Type arguments can themselves contain object/array/function type syntax —
  // `.setActive<{ organizationId: string }>(...)` is real, current shape in this API — so
  // only `<`/`>` are tracked. `;` is still a bail: a real generic argument list never
  // contains a bare statement terminator, and bailing there stops a stray comparison
  // operator (`.length < 3`) from scanning off into the rest of the file looking for a
  // `>` that isn't part of any generic list.
  let depth = 0;
  for (let i = start; i < Math.min(text.length, start + 2000); i += 1) {
    const char = text[i];
    if (char === "<") depth += 1;
    else if (char === ">") {
      depth -= 1;
      if (depth === 0) return i + 1;
      if (depth < 0) return null;
    } else if (char === ";") {
      return null;
    }
  }
  return null;
}

/**
 * Does a call follow at `pos` (after whitespace, optional `<Generics>`, optional `?.`)?
 * @returns {{ ok: true, end: number } | { ok: false }}
 */
function matchCallAhead(text, pos) {
  let i = skipWs(text, pos);
  if (text[i] === "<") {
    const after = matchBalancedAngles(text, i);
    if (after === null) return { ok: false };
    i = skipWs(text, after);
  }
  if (text[i] === "?" && text[i + 1] === ".") i = skipWs(text, i + 2);
  if (text[i] === "(") return { ok: true, end: i + 1 };
  return { ok: false };
}

/** `.foo`, `?.foo` — returns the identifier and the index just past it, or null. */
function matchPropertyAccess(text, pos) {
  let i = skipWs(text, pos);
  if (text[i] === "?" && text[i + 1] === ".") i += 2;
  else if (text[i] === ".") i += 1;
  else return null;
  i = skipWs(text, i);
  const rest = text.slice(i);
  const identifier = IDENTIFIER.exec(rest);
  if (!identifier) return null;
  return { name: identifier[0], end: i + identifier[0].length };
}

// ── 0. Symlink-safe file collection under a root ─────────────────────────────────────

const CODE_EXTENSION_SET = new Set(CODE_EXTENSIONS);

/** True when the repo-relative path is TypeScript or JavaScript source — the same rule
 * `repo.mjs`'s `isCode` applies, kept local so this walker has no other coupling to it. */
function isCodeFile(relativePath) {
  return CODE_EXTENSION_SET.has(path.extname(relativePath));
}

/**
 * Walk `rootRelative` (a repo-relative directory) the way `repo.mjs`'s `walk` does, with
 * one deliberate difference: a symlink is never blanket-skipped.
 *
 * `repo.mjs`'s `walk` is shared by fourteen other gates, none of which police a surface
 * that a symlink could be used to hide from, and changing its symlink handling would be a
 * blast-radius change to every one of them for a risk none of them carry. This scanner
 * gets its own walker instead of changing the shared one — see the pull request for why.
 *
 * A symlink encountered during the walk is handled three ways:
 *
 *   - it does not resolve at all (a broken link) -> skipped. There is no content to read,
 *     and no OS-level cycle (`ELOOP`) resolves either, so this also catches a mutual
 *     symlink pair without ever hanging.
 *   - it resolves (via `fs.realpath`) to a location INSIDE the repository -> followed, as
 *     if the entry were the real file or directory at that location. A `visitedRealPaths`
 *     set, keyed by realpath, makes revisiting an already-walked real location through a
 *     second symlink a no-op rather than an infinite descent — this is what stops a
 *     symlink that (directly or through a chain) points back at one of its own ancestor
 *     directories from looping forever.
 *   - it resolves to a location OUTSIDE the repository -> refused. This scanner does not
 *     read content it cannot check into the same tree the gate runs against; silently
 *     skipping it (the shared walker's current behaviour) is exactly the bypass this
 *     exists to close.
 *
 * @param {string} rootRelative repo-relative directory to walk
 * @param {string} repoRootAbsolute the repository root; symlinks resolving outside it are refused
 * @returns {Promise<{ files: string[], refusals: {absolute: string, reason: string}[] }>}
 */
export async function collectScanFiles(rootRelative, repoRootAbsolute) {
  const files = [];
  const refusals = [];
  const visitedRealPaths = new Set();
  const rootAbsolute = path.join(repoRootAbsolute, rootRelative);

  async function walkDir(dirAbsolute) {
    let entries;
    try {
      entries = await fs.readdir(dirAbsolute, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolute = path.join(dirAbsolute, entry.name);

      if (entry.isSymbolicLink()) {
        let real;
        try {
          real = await fs.realpath(absolute);
        } catch {
          continue; // broken link, or an OS-detected symlink cycle: nothing to read
        }
        const relativeToRepo = path.relative(repoRootAbsolute, real);
        const insideRepo =
          relativeToRepo === "" ||
          (!relativeToRepo.startsWith(`..${path.sep}`) &&
            relativeToRepo !== ".." &&
            !path.isAbsolute(relativeToRepo));
        if (!insideRepo) {
          refusals.push({
            absolute,
            reason:
              `symlink resolves to ${real}, outside the repository. This scanner cannot ` +
              "prove a target it does not check into the same tree has no live " +
              "`authClient.organization.*` caller, so it refuses rather than silently " +
              "omitting whatever the link points to.",
          });
          continue;
        }
        if (visitedRealPaths.has(real)) continue; // already walked via some other path
        visitedRealPaths.add(real);

        let targetStat;
        try {
          targetStat = await fs.stat(real);
        } catch {
          continue; // resolved, but vanished between realpath and stat — nothing to read
        }
        if (targetStat.isDirectory()) {
          if (ignoredDirectories.has(path.basename(real))) continue;
          await walkDir(real);
          continue;
        }
        if (targetStat.isFile()) {
          if (generatedFiles.has(path.basename(real))) continue;
          if (isCodeFile(path.relative(repoRootAbsolute, real)))
            files.push(real);
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        visitedRealPaths.add(absolute);
        await walkDir(absolute);
        continue;
      }

      if (!entry.isFile() || generatedFiles.has(entry.name)) continue;
      if (isCodeFile(path.relative(repoRootAbsolute, absolute)))
        files.push(absolute);
    }
  }

  visitedRealPaths.add(rootAbsolute);
  await walkDir(rootAbsolute);
  return { files: files.sort(), refusals };
}

// ── 1. Locate the client definition ──────────────────────────────────────────────────

const CREATE_AUTH_CLIENT =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*createAuthClient\s*\(/g;

/**
 * Find the one file that defines the auth client, and the name it exports it under.
 * Fails closed (throws) unless EXACTLY one definition exists — zero means the surface
 * this scanner exists to police is gone and reporting zero callers would be a lie about
 * why, and more than one means "the auth client" is no longer a single mechanical fact.
 *
 * @param {{absolute: string, source: string}[]} candidates comment-stripped already
 * @returns {{ file: string, exportName: string }}
 */
export function findAuthClientDefinition(candidates) {
  const found = [];
  for (const { absolute, source } of candidates) {
    CREATE_AUTH_CLIENT.lastIndex = 0;
    for (
      let match = CREATE_AUTH_CLIENT.exec(source);
      match !== null;
      match = CREATE_AUTH_CLIENT.exec(source)
    ) {
      found.push({ file: absolute, exportName: match[1] });
    }
  }
  if (found.length === 0) {
    throw new OrganizationCallerScanUnavailableError(
      "no `export const <name> = createAuthClient(` found anywhere scanned. Refusing to " +
        "run: this scanner locates the auth client by that call, and a surface with none " +
        "left cannot be distinguished from one this scanner can no longer see.",
    );
  }
  if (found.length > 1) {
    throw new OrganizationCallerScanUnavailableError(
      `${found.length} definitions of createAuthClient(...) found (${found
        .map((f) => f.file)
        .join(
          ", ",
        )}). "The auth client" is no longer a single mechanical fact; refusing ` +
        "to guess which one this gate is about.",
    );
  }
  return found[0];
}

// ── 2. Resolve import specifiers the same way tsconfig's `paths` do ─────────────────

/** `compilerOptions.paths` on an already-parsed tsconfig, turned into prefix →
 * target-directory rules relative to `baseDir` — unsorted; the caller merges rules from
 * more than one file and sorts once at the end. */
function extractPathRules(parsed, baseDir) {
  const paths = parsed.compilerOptions?.paths ?? {};
  const rules = [];
  for (const [key, targets] of Object.entries(paths)) {
    if (!key.endsWith("/*") || !Array.isArray(targets) || targets.length === 0)
      continue;
    const target = targets[0];
    if (typeof target !== "string" || !target.endsWith("/*")) continue;
    rules.push({
      prefix: key.slice(0, -1), // keep the trailing "/"
      targetDir: path.resolve(baseDir, target.slice(0, -1)),
    });
  }
  return rules;
}

/** Resolve a tsconfig `extends` or `references[].path` entry to an actual file on disk.
 * Either may name the config file directly, name it without its `.json` suffix, or name
 * a directory that itself contains a `tsconfig.json` — the same three shapes the real
 * compiler accepts. @returns {Promise<string | null>} */
async function resolveTsconfigReference(baseDir, specifier) {
  const candidate = path.resolve(baseDir, specifier);
  const attempts = [
    candidate,
    ...(candidate.endsWith(".json") ? [] : [`${candidate}.json`]),
    path.join(candidate, "tsconfig.json"),
  ];
  for (const attempt of attempts) {
    try {
      await fs.access(attempt);
      return attempt;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/**
 * `compilerOptions.paths`, followed through `extends` and `references` when the file
 * itself declares none — unsorted; `loadPathAliases` sorts the merged result once.
 *
 * This is the fix for a live foot-gun, not an attack: today every one of this
 * repository's real `authClient` importers resolves through the `@/` alias, and that
 * alias is declared TWICE — once in `apps/web/tsconfig.json` (which this scanner reads)
 * and once more in `apps/web/tsconfig.app.json` (which `tsconfig.json` `references` and
 * which is what the build and the editor actually resolve against). An entirely ordinary
 * deduplication — dropping the duplicate `paths` from the root file, leaving only the
 * `references` — would make the OLD single-file read here return `[]` with no error, and
 * from that commit on every `@/`-aliased import would fail to resolve: not a caller
 * missed, ALL of them, silently, as "0 calls, 0 refusals". Following `extends`/
 * `references` when the root file's own `paths` is empty closes that; `visited` stops a
 * cycle between configs from recursing forever.
 *
 * @returns {Promise<{ prefix: string, targetDir: string }[]>} unsorted
 */
async function collectPathRules(tsconfigAbsolutePath, visited = new Set()) {
  if (visited.has(tsconfigAbsolutePath)) return [];
  visited.add(tsconfigAbsolutePath);

  let raw;
  try {
    raw = await fs.readFile(tsconfigAbsolutePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return []; // a referenced/extended config that vanished
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(stripCodeComments(raw));
  } catch (error) {
    throw new OrganizationCallerScanUnavailableError(
      `${tsconfigAbsolutePath} could not be parsed as JSON once comments were stripped: ` +
        `${error.message}. Refusing to guess its path aliases.`,
    );
  }

  const baseDir = path.dirname(tsconfigAbsolutePath);
  const ownRules = extractPathRules(parsed, baseDir);
  if (ownRules.length > 0) return ownRules;

  if (typeof parsed.extends === "string") {
    const extended = await resolveTsconfigReference(baseDir, parsed.extends);
    if (extended !== null) {
      const inherited = await collectPathRules(extended, visited);
      if (inherited.length > 0) return inherited;
    }
  }

  if (Array.isArray(parsed.references)) {
    const merged = [];
    const seenPrefixes = new Set();
    for (const reference of parsed.references) {
      if (!reference || typeof reference.path !== "string") continue;
      const referenced = await resolveTsconfigReference(
        baseDir,
        reference.path,
      );
      if (referenced === null) continue;
      for (const rule of await collectPathRules(referenced, visited)) {
        if (seenPrefixes.has(rule.prefix)) continue;
        seenPrefixes.add(rule.prefix);
        merged.push(rule);
      }
    }
    if (merged.length > 0) return merged;
  }

  return [];
}

/**
 * Read `compilerOptions.paths` out of a tsconfig (JSONC — comments stripped first, no
 * dependency added), following `extends`/`references` when the file itself declares none,
 * and turn it into ordered prefix → target-directory rules. This is "derive the surface":
 * the alias table a caller can use is exactly the one the real compiler resolves against,
 * never a hand-copied guess at what `@/` means.
 *
 * Fails closed rather than returning `[]` when no alias map can be found anywhere in the
 * `extends`/`references` chain — see `collectPathRules`'s docstring for the exact
 * collapse an empty-but-unnoticed alias map would cause.
 *
 * @returns {Promise<{ prefix: string, targetDir: string }[]>} longest prefix first
 */
export async function loadPathAliases(tsconfigAbsolutePath) {
  const rules = await collectPathRules(tsconfigAbsolutePath);
  if (rules.length === 0) {
    throw new OrganizationCallerScanUnavailableError(
      `${tsconfigAbsolutePath} declares no compilerOptions.paths, directly or through its ` +
        "extends/references chain. This scanner resolves every alias-style import " +
        "(`@/...`) through that map; without it every such import would silently fail to " +
        "resolve and this scanner would report a caller count of zero it cannot back up. " +
        "Refusing to guess.",
    );
  }
  rules.sort((a, b) => b.prefix.length - a.prefix.length);
  return rules;
}

/**
 * Resolve an import specifier to an absolute file path, the way node's ESM resolution
 * plus tsconfig `paths` would — relative specifiers resolve against the importing file;
 * everything else is tried against every alias rule. Bare package specifiers (anything
 * that resolves to nothing) return null, which callers read as "not the module we care
 * about" rather than an error — most imports in a file are not importing the auth client.
 *
 * @returns {string | null} absolute path with no guarantee the file exists on disk yet —
 *   callers check that themselves via `resolveExistingFile`.
 */
export function resolveImportPath(fromFileAbsolute, specifier, aliasRules) {
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(fromFileAbsolute), specifier);
  }
  for (const rule of aliasRules) {
    if (specifier.startsWith(rule.prefix)) {
      return path.join(rule.targetDir, specifier.slice(rule.prefix.length));
    }
  }
  return null;
}

/** First existing file among the extensionless candidate and its usual TS/JS variants. */
export async function resolveExistingFile(candidateNoExtension) {
  if (path.extname(candidateNoExtension) !== "") {
    try {
      await fs.access(candidateNoExtension);
      return candidateNoExtension;
    } catch {
      return null;
    }
  }
  for (const ext of CODE_EXTENSIONS) {
    const withExt = `${candidateNoExtension}${ext}`;
    try {
      await fs.access(withExt);
      return withExt;
    } catch {
      // try the next
    }
  }
  for (const ext of CODE_EXTENSIONS) {
    const withIndex = path.join(candidateNoExtension, `index${ext}`);
    try {
      await fs.access(withIndex);
      return withIndex;
    } catch {
      // try the next
    }
  }
  return null;
}

// ── 3. Import-clause grammar ──────────────────────────────────────────────────────────

/**
 * S4: this regex runs over the STRING-INTACT pass (`code` — comments stripped, string
 * CONTENTS untouched), which is what lets an `import` keyword spelled inside a string
 * literal — a docs string, an error message, a code-sample constant — start a match at all.
 * Its lazy `[^;]*?` clause then bridges across real code (a live
 * `authClient.organization.*` call among it, potentially) to a LATER `from "…"`-shaped
 * string elsewhere in the same statement or object literal, which may itself be nothing but
 * string content too. `parseImportClause` only inspects the first `{…}` group of whatever
 * got captured and never checks that the rest of the span is genuine code, so this phantom
 * match parses as a clean named import, resolves to the real auth-client definition file,
 * and its entire span — real call included — is recorded as an `importRanges` entry that
 * then suppresses that real call. Demonstrated against the real checker, not theorised: an
 * ordinary file with a real `import { authClient } from "@/lib/auth-client";` up top, a live
 * `authClient.organization.setActive(...)` call, and two unrelated docs-style string
 * literals — one mentioning `"import { authClient }"`, a later one mentioning `"adapted
 * from '@/lib/auth-client'"` — produced a clean `[]` result: the call neither counted nor
 * refused. `findImportStatements` below closes this by cross-checking each match's `import`
 * keyword against the STRING-STRIPPED pass at the same offset — see `isRealImportKeyword`.
 */
const IMPORT_STATEMENT = /import\s+([^;]*?)\s+from\s*["']([^"']+)["'];?/g;

/**
 * Is the `import` keyword `IMPORT_STATEMENT` matched at `matchIndex` in `code` (the
 * STRING-INTACT pass) genuine code, rather than a phantom produced by string content that
 * only the STRING-INTACT pass leaves untouched?
 *
 * `code` and `codeForScan` are two independent `stripCodeComments` passes over the exact
 * same `source`, differing only in whether string/template CONTENTS are blanked — every
 * character OUTSIDE a string or template body is identical between the two, at the same
 * offset (see the fuller comment where `scanFiles` computes them). So the six characters
 * `import` this match found are real code if and only if `codeForScan` still reads `import`
 * at that same offset: when they were really inside a string, the blanking pass has
 * replaced them with spaces at that very position; when they were real code, blanking some
 * OTHER string elsewhere in the file never touches them.
 *
 * @returns {boolean}
 */
function isRealImportKeyword(codeForScan, matchIndex) {
  return codeForScan.startsWith("import", matchIndex);
}

/**
 * `export ... from "<specifier>"` — a re-export declaration, in both its named
 * (`export { authClient } from "./auth-client"`) and star (`export * from "./auth-client"`)
 * forms.
 *
 * This exists because a re-export was a **live bypass of this whole gate**, demonstrated
 * rather than imagined. With
 *
 *     // apps/web/src/lib/barrel.ts
 *     export { authClient } from "./auth-client";
 *     // apps/web/src/anywhere.ts
 *     import { authClient } from "./lib/barrel";
 *     await authClient.organization.setActive({ organizationId });
 *
 * the scanner reported its usual count and **exit 0**: it neither counted the call nor
 * refused it. The reason is structural — `scanFiles` treats an import as the auth client only
 * when its specifier resolves to the definition file, and a consumer of the barrel resolves
 * to the barrel. Following re-exports transitively would mean re-deriving module resolution
 * one level deeper for every module in the tree; refusing is cheaper and is what this module
 * already commits to for any shape it cannot prove safe.
 *
 * Nothing in `apps/web/src` re-exports the binding today — the only `export` of it is its own
 * definition — so the rule is green on the current tree and armed for the commit that would
 * otherwise have slipped a caller past S10's precondition.
 */
const EXPORT_FROM_STATEMENT = /export\s+([^;]*?)\s+from\s*["']([^"']+)["'];?/g;

/**
 * @typedef {object} ImportClause
 * @property {"named"|"namespace"|"unrecognized"} kind
 * @property {{name: string, alias: string, typeOnly: boolean}[]} [named]
 * @property {string} [namespaceName]
 */

/** @returns {ImportClause} */
function parseImportClause(clauseRaw) {
  let clause = clauseRaw.trim();
  let statementTypeOnly = false;
  const typeMatch = /^type\s+/.exec(clause);
  if (typeMatch) {
    statementTypeOnly = true;
    clause = clause.slice(typeMatch[0].length).trim();
  }

  const namespaceMatch = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
  if (namespaceMatch) {
    return { kind: "namespace", namespaceName: namespaceMatch[1] };
  }

  const braceMatch = /\{([^}]*)\}/.exec(clause);
  if (!braceMatch) {
    // A bare default import (`import Foo from "spec"`) is the only other legal shape,
    // and the auth-client module has no default export, so nothing here can ever bind
    // its named export. Treat as "nothing relevant", not a refusal.
    if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
      return { kind: "named", named: [] };
    }
    return { kind: "unrecognized" };
  }

  const named = [];
  for (const part of braceMatch[1].split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const entry =
      /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(
        trimmed,
      );
    if (!entry) return { kind: "unrecognized" };
    named.push({
      name: entry[2],
      alias: entry[3] ?? entry[2],
      typeOnly: statementTypeOnly || Boolean(entry[1]),
    });
  }
  return { kind: "named", named };
}

/**
 * Every `import ... from "..."` statement in `code` (comments already stripped, strings
 * intact), with enough to resolve, classify and exclude it from the later scan.
 *
 * S4: a match whose `import` keyword is only present because the STRING-INTACT pass leaves
 * string CONTENTS untouched — i.e. `isRealImportKeyword` finds it already blanked away in
 * `codeForScan` at the same offset — is not a statement at all, and is dropped before it can
 * ever reach `importRanges` or `rootAliasNames`. This is a plain skip, not a refusal: the
 * phantom text itself proves nothing unsafe, and a file that genuinely imports the auth
 * client always does so through a real, separate import statement elsewhere, which this
 * same pass still finds and still traces normally.
 *
 * @param {string} codeForScan the STRING-STRIPPED sibling pass over the same source (see
 *   `scanFiles`), used only to distinguish a real `import` keyword from a phantom one.
 * @returns {{ clause: ImportClause, specifier: string, startLine: number, endLine: number }[]}
 */
function findImportStatements(code, codeForScan) {
  const statements = [];
  IMPORT_STATEMENT.lastIndex = 0;
  for (
    let match = IMPORT_STATEMENT.exec(code);
    match !== null;
    match = IMPORT_STATEMENT.exec(code)
  ) {
    if (!isRealImportKeyword(codeForScan, match.index)) continue;
    statements.push({
      clause: parseImportClause(match[1]),
      specifier: match[2],
      startLine: lineOf(code, match.index),
      endLine: lineOf(code, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return statements;
}

/** Every `export ... from "<specifier>"` in the file, with its clause and specifier. */
function findExportFromStatements(code) {
  const statements = [];
  EXPORT_FROM_STATEMENT.lastIndex = 0;
  for (
    let match = EXPORT_FROM_STATEMENT.exec(code);
    match !== null;
    match = EXPORT_FROM_STATEMENT.exec(code)
  ) {
    statements.push({
      clause: match[1].trim(),
      specifier: match[2],
      startLine: lineOf(code, match.index),
    });
  }
  return statements;
}

/**
 * A dynamic `import("<specifier>")` call — `await import(...)` or otherwise. Distinguished
 * from the static `IMPORT_STATEMENT` grammar above by having no `from` clause at all: this
 * is a call expression, not a declaration. Always refused when its specifier resolves to
 * the auth-client definition (see the call site in `scanFiles`) — tracing what the awaited
 * value is destructured or member-accessed into afterward would mean re-deriving this
 * whole alias analysis for an expression rather than a name bound at parse time, for a
 * shape nothing in this repository uses today.
 */
const DYNAMIC_IMPORT_CALL = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * ANY `import(...)` call at all, literal or not — found by a formal review's second
 * bypass, one level past F7: a dynamic `import(someComputedSpecifier)` whose argument is
 * NOT a simple string literal never matches `DYNAMIC_IMPORT_CALL` above (that regex
 * requires quotes immediately inside the parens), so it is invisible to F1 too — and if
 * the caller ALSO builds the property name it reads off the imported module via string
 * concatenation instead of writing `authClient` literally, `mentionsBinding` (a raw
 * substring check) never fires either, and F7's `STRING_EVAL_SINK` check never gets the
 * chance to run. Reproduced end-to-end against the real checker binary: a computed
 * specifier plus a concatenated property name plus a genuine `eval(...)` call produced
 * `exit 0`, "0 live call sites", the evil file mentioned nowhere. The fix is the same
 * principle this module already applies to a bare reference it cannot classify: refuse
 * unconditionally rather than attempt to resolve or prove safety for a specifier this
 * scanner cannot read at parse time. This intentionally refuses EVERY non-literal dynamic
 * import in a scanned file, not only ones plausibly reaching the auth client — there is no
 * way to tell the difference without evaluating the computed expression, which is exactly
 * what a static scanner cannot do.
 */
const ANY_DYNAMIC_IMPORT_CALL = /\bimport\s*\(\s*([^)]*)\)/g;

/**
 * A CommonJS `require("<specifier>")` call. This module's whole import grammar
 * (`IMPORT_STATEMENT`, `EXPORT_FROM_STATEMENT`) is ESM-only; `require(...)` is a different
 * grammar it was never taught, so — same as the dynamic import above — a `require()` that
 * resolves to the auth-client definition is always refused rather than silently unmatched.
 * `.cjs`/`.cts` files are exactly the shape most likely to use this, but the check applies
 * to every scanned file: a `.ts` file can `require()` too (build scripts, interop shims).
 */
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * A string-evaluation sink — `eval(`, `new Function(`, `setTimeout(`, `setInterval(` —
 * found by a real bypass a formal review constructed and ran:
 * `eval("authClient.organization.setActive({...})")` invokes the real call (confirmed by
 * running it), but this scanner's call-site pass reads `codeForScan =
 * stripCodeComments(source, { blankStrings: true })`, which blanks the CONTENTS of every
 * string/template literal before `scanOccurrences` ever looks at it. An
 * `authClient.organization.*` call spelled inside a string handed to one of these sinks is
 * therefore not "a shape this scanner refuses to classify" the way a dynamic import or
 * `require()` is — it is a shape the scanner never looks at at all, and it produces an
 * unchanged, unreduced call count identical to a clean tree. Same remedy as the dynamic
 * import/require refusals below: refuse the whole file rather than attempt to parse
 * arbitrary string contents for a call shape, exactly the class of guess this module's own
 * design already refuses to make everywhere else. `eval`/`Function` always evaluate a
 * string, so any call is a match; `setTimeout`/`setInterval` only evaluate a string in
 * their legacy string-argument form (`setTimeout("code", ms)`), so the match is narrowed
 * to that shape (next non-space token is a quote or backtick) -- the ordinary
 * `setTimeout(() => ..., ms)` function-argument form is unconditionally safe here and
 * matching it too produced real false positives on ordinary websocket/polling code during
 * this fix's own verification.
 */
const STRING_EVAL_SINK =
  /\b(?:eval|Function)\s*\(|\b(?:setTimeout|setInterval)\s*\(\s*["'`]/;

/** Every match of `pattern` (a `/g` regex with one capture group: the specifier) in
 * `code`, as `{specifier, line, snippet}`. Shared by the dynamic-import and require scans;
 * neither needs anything beyond "where is this specifier, and what resolves it". */
function findSpecifierCalls(code, pattern) {
  const found = [];
  pattern.lastIndex = 0;
  for (
    let match = pattern.exec(code);
    match !== null;
    match = pattern.exec(code)
  ) {
    found.push({
      specifier: match[1],
      line: lineOf(code, match.index),
      snippet: snippetAt(code, match.index),
    });
  }
  return found;
}

// ── 4. Per-file alias discovery: import bindings, plus the two recognised local-alias
//      shapes for the `.organization` sub-client ──────────────────────────────────────

/**
 * `const NAME = <rootAlias>.organization;` and `const { organization[: NAME] } = <rootAlias>;`
 * — the only two ways this scanner will trace a further local alias. Anything else that
 * assigns `<rootAlias>` or `<rootAlias>.organization` to a new name is a refusal, raised
 * by the general scan below once these two patterns have claimed the character ranges they
 * explain.
 *
 * Consumption is tracked by CHARACTER RANGE, not by physical line. A whole-line suppression
 * was a demonstrated bypass: `const { useSession } = authClient; authClient.organization.
 * setActive({...});` on one physical line silently dropped the second, real, uncloaked call
 * — it shares a line with the destructure, so line-based suppression swallowed it along with
 * the destructure statement it was meant to explain. Only the exact span of the matched
 * statement is consumed now, so a second, distinct statement sharing that line is never
 * shadowed by it.
 *
 * @returns {{ orgAliases: Map<string, string>, consumedRanges: {start: number, end: number}[] }}
 *   orgAliases maps local name -> the root alias it was derived from (informational only);
 *   consumedRanges are the exact `[start, end)` character spans these two patterns account
 *   for, which the general scan must not re-examine.
 */
function findAliasCreations(code, rootAliasNames) {
  const orgAliases = new Map();
  const consumedRanges = [];

  for (const root of rootAliasNames) {
    const escaped = escapeRegExp(root);

    const plain = new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escaped}\\s*(?:\\?\\.|\\.)\\s*organization\\s*[;\\n]`,
      "g",
    );
    for (let m = plain.exec(code); m !== null; m = plain.exec(code)) {
      orgAliases.set(m[1], root);
      consumedRanges.push({ start: m.index, end: m.index + m[0].length });
    }

    const destructure = new RegExp(
      `(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${escaped}\\s*[;\\n]`,
      "g",
    );
    for (
      let m = destructure.exec(code);
      m !== null;
      m = destructure.exec(code)
    ) {
      const keys = m[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      let sawOrganization = false;
      for (const key of keys) {
        const entry = /^organization\s*(?::\s*([A-Za-z_$][\w$]*))?$/.exec(key);
        if (entry) {
          sawOrganization = true;
          orgAliases.set(entry[1] ?? "organization", root);
        }
      }
      if (sawOrganization || keys.length > 0) {
        consumedRanges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }

  return { orgAliases, consumedRanges };
}

// ── 5. The general occurrence scan ────────────────────────────────────────────────────

/**
 * @param {string} code comment-stripped, string-blanked source
 * @param {Map<string, "root"|"org">} aliasKinds
 * @param {{start: number, end: number}[]} consumedRanges exact character spans (imports,
 *   alias creations) already explained, which must not be re-examined here
 * @returns {{ calls: {family: string, line: number, snippet: string}[], refusals: {line: number, reason: string, snippet: string}[] }}
 */
function scanOccurrences(code, aliasKinds, consumedRanges) {
  const calls = [];
  const refusals = [];
  if (aliasKinds.size === 0) return { calls, refusals };

  const alternation = [...aliasKinds.keys()].map(escapeRegExp).join("|");
  // `\b` is a WORD boundary — it does not treat `$` as a boundary character at all, because
  // `$` is not itself a word character, but it also does not stop a run of identifier
  // characters that CONTAINS one. An alias whose name starts or ends with `$` (`$auth`,
  // `authClient as $auth`) therefore never matched `\b(?:...)\b`, in either direction: this
  // was a **demonstrated bypass**, not a hypothetical — `import { authClient as $auth }
  // from "@/lib/auth-client"; await $auth.organization.setActive({...});` and `const $org =
  // authClient.organization; await $org.setActive({...});` both produced exit 0 with the
  // call site neither counted nor refused. The fix excludes `$` as a valid
  // identifier-continuation character on both sides explicitly, via a negative
  // lookbehind/lookahead, instead of relying on `\b`'s word/non-word notion of a boundary.
  const pattern = new RegExp(`(?<![\\w$])(?:${alternation})(?![\\w$])`, "g");

  for (
    let match = pattern.exec(code);
    match !== null;
    match = pattern.exec(code)
  ) {
    const name = match[0];
    const start = match.index;
    const end = start + name.length;
    const line = lineOf(code, start);
    if (
      consumedRanges.some((range) => start >= range.start && start < range.end)
    )
      continue;

    const before = previousNonSpace(code, start);
    if (before >= 0 && code[before] === ".") continue; // a property named this, on some
    // other object — not our tracked identifier.

    const word = precedingWord(code, start);
    if (word && DECLARATION_KEYWORDS.has(word.word)) continue; // declares a NEW binding
    // with this name (including the module's own `export const authClient = …`), not a
    // use of an existing one.

    // Object-literal key: `{ authClient: ... }` / `, authClient: ...` — a property NAME
    // in a literal (test-mock factories build these), not a reference to the real value.
    const afterForKey = skipWs(code, end);
    if (
      code[afterForKey] === ":" &&
      before >= 0 &&
      (code[before] === "{" || code[before] === ",")
    ) {
      continue;
    }

    const kind = aliasKinds.get(name);
    const snippet = snippetAt(code, start);

    const property = matchPropertyAccess(code, end);
    if (property) {
      if (kind === "root") {
        if (property.name !== "organization") continue; // some other member — out of scope

        // `.organization` resolved. The only shape this scanner traces past this point is
        // an immediate method call — `.organization.method(...)`, generics and optional
        // chaining allowed at either link. Everything else is a refusal.
        const method = matchPropertyAccess(code, property.end);
        if (method) {
          const methodCall = matchCallAhead(code, method.end);
          if (methodCall.ok) {
            calls.push({ family: method.name, line, snippet });
            continue;
          }
          refusals.push({
            line,
            snippet,
            reason:
              `\`.organization.${method.name}\` is referenced without being called. ` +
              "A method reference that is not immediately invoked cannot be proven to " +
              "never run.",
          });
          continue;
        }
        if (matchCallAhead(code, property.end).ok) {
          refusals.push({
            line,
            snippet,
            reason:
              "`.organization(...)` is called directly (no method name) — not a shape " +
              "this scanner recognises as a plugin method invocation.",
          });
          continue;
        }
        if (code[skipWs(code, property.end)] === "[") {
          refusals.push({
            line,
            snippet,
            reason:
              "`.organization[` — computed member access. The property selected is " +
              "not a source literal this scanner can rule out as a plugin method.",
          });
          continue;
        }
        refusals.push({
          line,
          snippet,
          reason:
            "`.organization` used in a shape that is neither a direct method call " +
            "nor one of the two recognised alias forms (`const x = client.organization;` / " +
            "`const { organization } = client;`).",
        });
        continue;
      }

      // kind === "org": this identifier already IS the organization sub-client.
      const call = matchCallAhead(code, property.end);
      if (call.ok) {
        calls.push({ family: property.name, line, snippet });
        continue;
      }
      refusals.push({
        line,
        snippet,
        reason: `\`${name}.${property.name}\` is referenced without being called.`,
      });
      continue;
    }

    if (code[skipWs(code, end)] === "[") {
      refusals.push({
        line,
        snippet,
        reason: `\`${name}[\` — computed member access on ${kind === "root" ? "the auth client" : "the organization client"}.`,
      });
      continue;
    }

    refusals.push({
      line,
      snippet,
      reason:
        `\`${name}\` (${kind === "root" ? "the auth client" : "the organization client"}) ` +
        "is referenced bare, in a shape this scanner does not already understand as an " +
        "import, a declaration, an object-literal key, or a recognised alias assignment. " +
        "It cannot be proven this reference never reaches `.organization`.",
    });
  }

  return { calls, refusals };
}

/**
 * Does `fromAbsolute` (an existing file) reach the auth-client definition through a chain
 * of `export ... from` re-exports — however many hops, wherever those hops live?
 *
 * This is what closes F3: `SCAN_ROOT` is `apps/web/src`, and a barrel file OUTSIDE it that
 * re-exports the client is never itself walked or read by anything else in this module —
 * `findExportFromStatements` only ever runs on files `scanFiles` was handed, and a barrel
 * rooted outside the scanned root is not one of them. The only remaining observation point
 * is an IN-ROOT import that resolves TO such a barrel; this is what that resolution calls
 * once it finds the target is not the definition file directly.
 *
 * `visited` is shared across the whole recursive descent (not per-branch) so a cycle
 * between re-exporting files terminates rather than exploring the same file twice.
 *
 * @returns {Promise<boolean>}
 */
async function reexportsDefinitionTransitively(
  fromAbsolute,
  aliasRules,
  definitionAbsolutePath,
  readFile,
  visited,
) {
  if (fromAbsolute === definitionAbsolutePath) return true;
  if (visited.has(fromAbsolute)) return false;
  visited.add(fromAbsolute);

  let source;
  try {
    source = await readFile(fromAbsolute);
  } catch {
    return false; // unreadable: cannot prove a chain runs through it either
  }
  const code = stripCodeComments(source);
  for (const reExport of findExportFromStatements(code)) {
    const base = resolveImportPath(
      fromAbsolute,
      reExport.specifier,
      aliasRules,
    );
    if (base === null) continue;
    const resolved = await resolveExistingFile(base);
    if (resolved === null) continue;
    if (
      await reexportsDefinitionTransitively(
        resolved,
        aliasRules,
        definitionAbsolutePath,
        readFile,
        visited,
      )
    ) {
      return true;
    }
  }
  return false;
}

// ── 6. Orchestration ──────────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {string} args.definitionAbsolutePath the resolved file defining the client
 * @param {string} args.exportName the name it is exported under (usually `authClient`)
 * @param {{prefix:string, targetDir:string}[]} args.aliasRules tsconfig path aliases
 * @param {string[]} args.files absolute paths of every code file to scan
 * @param {(absolute: string) => Promise<string>} args.readFile
 * @returns {Promise<{ file: string, calls: object[], refusals: object[] }[]>} one entry
 *   per file that imports the client, in the order `files` was given
 */
export async function scanFiles({
  definitionAbsolutePath,
  exportName,
  aliasRules,
  files,
  readFile,
}) {
  const results = [];

  for (const absolute of files) {
    const source = await readFile(absolute);
    // Fast path. It cannot be "does this file mention the binding" alone: `export * from
    // "./auth-client"` re-exports it without ever spelling `authClient`, and skipping such
    // a file on that basis is exactly what let the star form past the re-export refusal
    // below — found by that refusal's own red probe, not by review. A file must therefore
    // also be read whenever it could carry a re-export at all.
    const mentionsBinding = source.includes(exportName);
    const couldReExport = source.includes("export") && source.includes("from");
    // F4: a `require("…")` of the client reaches it without ever spelling a static
    // `import ... from` clause, and (for the direct member-access shape, e.g.
    // `require("...").authClient…`) without necessarily spelling `exportName` either if the
    // specifier alone is what resolves — so this substring is its own reason to read the
    // file, same as `couldReExport` already is for `export`.
    const couldRequire = source.includes("require(");
    // S3: a STATIC `import ... from` statement — of ANYTHING, any specifier, any local
    // binding name — can still reach the auth client, because the specifier may resolve,
    // directly or through a further chain of `export ... from` re-exports (see
    // `reexportsDefinitionTransitively`), to the definition under a LOCAL alias name that
    // never spells `exportName` anywhere in this file at all. `mentionsBinding` alone cannot
    // catch that. This was a **demonstrated bypass**, not a hypothetical: an out-of-root
    // barrel file (outside `apps/web/src`, never itself scanned) re-exporting the client
    // under a renamed binding —
    //
    //   // shared/auth-client-alias.ts (outside the scanned root)
    //   export { authClient as foo } from "../apps/web/src/lib/auth-client";
    //
    // — consumed by an in-root file that only ever spells the LOCAL alias `foo` —
    //
    //   // apps/web/src/somewhere.ts
    //   import { foo } from "../../../shared/auth-client-alias";
    //   await foo.organization.setActive({ organizationId });
    //
    // — never mentions `authClient` (`mentionsBinding` false), never contains the literal
    // token `export` (`couldReExport` false: the consuming file only IMPORTS, it does not
    // itself re-export anything), and uses neither a dynamic `import(` nor `require(`
    // (`couldRequire` false). Without a check keyed on the presence of a static import
    // statement itself, this file was skipped by the fast path and **never read at all** —
    // the call site was neither counted nor refused, a clean exit 0. This scanner cannot
    // know, from a substring check alone, which local name an import binds or what it
    // resolves to; catching that is the entire reason the full parse below exists, so any
    // file that could contain a static `import` statement must reach it — this covers the
    // dynamic-import form too (`import(`), making a separate check for it redundant.
    const couldStaticallyImport = source.includes("import");
    if (
      !mentionsBinding &&
      !couldReExport &&
      !couldRequire &&
      !couldStaticallyImport
    )
      continue;

    const code = stripCodeComments(source);
    // `code` (comments stripped, string CONTENTS intact — needed to read a real specifier's
    // text) and `codeForScan` (also string-blanked) are two independent `stripCodeComments`
    // passes over this same `source`, identical in length and in every character outside a
    // string/template body — delimiters, comment collapsing, and every length-changing
    // decision are the same between the two — so a character offset computed against one
    // names the exact same source position in the other. `findImportStatements` uses that
    // property (S4) to tell a real `import` keyword from one that only exists as string
    // content; `findAliasCreations`/`scanOccurrences` further below reuse it again to let
    // `importRanges` (computed against `code`) double as `consumedRanges` against
    // `codeForScan`.
    const codeForScan = stripCodeComments(source, { blankStrings: true });
    const statements = findImportStatements(code, codeForScan);

    const rootAliasNames = new Set();
    const importRanges = [];
    const refusals = [];

    // A re-export of the binding puts it behind a module path that no consumer's import
    // will resolve to the definition, so every caller reached through it is invisible to
    // this scanner. Refuse, rather than report a count that is silently incomplete. This
    // also covers a re-export that reaches the definition through a further chain of
    // `export ... from` hops (F3) — `resolved` need not equal `definitionAbsolutePath`
    // directly for the chain to still end there.
    for (const reExport of findExportFromStatements(code)) {
      const reExportBase = resolveImportPath(
        absolute,
        reExport.specifier,
        aliasRules,
      );
      if (reExportBase === null) continue;
      const resolved = await resolveExistingFile(reExportBase);
      if (resolved === null) continue;
      const isDirect = resolved === definitionAbsolutePath;
      const isChained =
        !isDirect &&
        (await reexportsDefinitionTransitively(
          resolved,
          aliasRules,
          definitionAbsolutePath,
          readFile,
          new Set([absolute]),
        ));
      if (!isDirect && !isChained) continue;
      refusals.push({
        line: reExport.startLine,
        snippet: `export ${reExport.clause} from "${reExport.specifier}"`,
        reason: isDirect
          ? "re-export of the auth-client module. Callers reaching the binding through " +
            "this module path are not traced by this scanner, so the count it reports " +
            "would be incomplete."
          : `"${reExport.specifier}" re-exports the auth-client module through a further ` +
            "chain of one or more files. Callers reaching the binding through this " +
            "module path are not traced by this scanner, so the count it reports would " +
            "be incomplete.",
      });
    }

    // F1: a dynamic `import("<specifier>")` of the definition. The awaited value's shape
    // afterward (destructured, member-accessed, reassigned) is not traced — refused
    // outright, the same choice this module already makes for a namespace import.
    for (const call of findSpecifierCalls(code, DYNAMIC_IMPORT_CALL)) {
      const base = resolveImportPath(absolute, call.specifier, aliasRules);
      if (base === null) continue;
      if ((await resolveExistingFile(base)) !== definitionAbsolutePath)
        continue;
      refusals.push({
        line: call.line,
        snippet: call.snippet,
        reason:
          `dynamic \`import("${call.specifier}")\` of the auth-client module. This ` +
          "scanner only traces the binding through a static `import ... from` " +
          "declaration; a dynamically imported value could reach `.organization` " +
          "through any shape at all, and none of them are checked here.",
      });
    }

    // F8: a dynamic `import(...)` whose argument is not a simple string literal — the
    // regex above already resolved and refused the literal-specifier case; this one
    // catches every OTHER shape `import(` can take (a variable, a template literal, a
    // concatenation, a function call). Deliberately unconditional: this scanner cannot
    // evaluate the argument, so it cannot prove such an import never resolves to the
    // auth-client module. Skips import( calls DYNAMIC_IMPORT_CALL already turned into a
    // refusal above, so a literal-specifier import that DID resolve to the client is not
    // double-refused with two different messages.
    {
      const literalImportLines = new Set(
        findSpecifierCalls(code, DYNAMIC_IMPORT_CALL).map((call) => call.line),
      );
      for (const call of findSpecifierCalls(code, ANY_DYNAMIC_IMPORT_CALL)) {
        if (literalImportLines.has(call.line)) continue;
        const arg = call.specifier.trim();
        // A literal-specifier call ALSO matches this broader regex (its capture group is
        // the raw parenthesised text, e.g. `"./foo"` including the quotes) — skip it here
        // too, whether or not it happened to land on the same line as another call above.
        if (/^["'][^"']*["']$/.test(arg)) continue;
        refusals.push({
          line: call.line,
          snippet: call.snippet,
          reason:
            "a dynamic `import(...)` whose argument is not a simple string literal. This " +
            "scanner cannot evaluate the argument, so it cannot prove this import never " +
            "resolves to the auth-client module — refused rather than silently assumed " +
            "safe.",
        });
      }
    }

    // F4: a CommonJS `require("<specifier>")` of the definition — a different grammar
    // this scanner's `IMPORT_STATEMENT`/`EXPORT_FROM_STATEMENT` regexes were never taught,
    // so (same reasoning as the dynamic import above) always refused rather than traced.
    for (const call of findSpecifierCalls(code, REQUIRE_CALL)) {
      const base = resolveImportPath(absolute, call.specifier, aliasRules);
      if (base === null) continue;
      if ((await resolveExistingFile(base)) !== definitionAbsolutePath)
        continue;
      refusals.push({
        line: call.line,
        snippet: call.snippet,
        reason:
          `CommonJS \`require("${call.specifier}")\` of the auth-client module. This ` +
          "scanner's import grammar is ESM-only (`import ... from`); a `require()` " +
          "of the same module is not traced by it at all.",
      });
    }

    // F7: `eval(`/`new Function(`/`setTimeout(`/`setInterval(` anywhere in a file that even
    // MENTIONS the auth-client export name — including inside a string literal, which is
    // exactly the shape `mentionsBinding` (computed on the raw, unstripped `source` above)
    // already catches. Deliberately not restricted to files with a static import of the
    // root alias: the whole point is that a call spelled inside a string never creates one.
    // This will over-refuse an unrelated `eval`/`setTimeout` call in a file that also
    // happens to import the auth client for something else — accepted, because a refusal
    // is reviewed by a human and a silent zero is not, and this scanner's own design
    // already makes that trade everywhere else (see the re-export and dynamic-import
    // refusals above).
    if (mentionsBinding && STRING_EVAL_SINK.test(source)) {
      const sinkMatch = source.match(STRING_EVAL_SINK);
      const sinkLine = source.slice(0, sinkMatch.index).split("\n").length;
      refusals.push({
        line: sinkLine,
        snippet: sinkMatch[0],
        reason:
          "this file mentions the auth-client export name and also calls a " +
          "string-evaluation sink (`eval`/`Function`/`setTimeout`/`setInterval`). A call " +
          "spelled inside a string handed to one of these is invisible to this scanner's " +
          "call-site pass, which blanks string-literal contents before scanning — refused " +
          "rather than silently undercounted.",
      });
    }

    for (const statement of statements) {
      const resolvedBase = resolveImportPath(
        absolute,
        statement.specifier,
        aliasRules,
      );
      if (resolvedBase === null) continue;
      const resolved = await resolveExistingFile(resolvedBase);
      if (resolved === null) continue;
      if (resolved !== definitionAbsolutePath) {
        // F3: not the definition file directly — but does it get there through a further
        // chain of re-exports, possibly rooted entirely outside the scanned root? If so,
        // this import is not "unrelated"; it is the only place left to notice the chain.
        if (
          await reexportsDefinitionTransitively(
            resolved,
            aliasRules,
            definitionAbsolutePath,
            readFile,
            new Set([absolute]),
          )
        ) {
          refusals.push({
            line: statement.startLine,
            snippet: `import ... from "${statement.specifier}"`,
            reason:
              `"${statement.specifier}" does not resolve directly to the auth-client ` +
              "definition, but re-exports it through a chain of one or more further " +
              "files (possibly outside apps/web/src). This scanner does not trace " +
              "re-export chains rooted outside the file it is reading, and refuses " +
              "rather than silently treating the import as unrelated.",
          });
        }
        continue;
      }

      importRanges.push({ start: statement.start, end: statement.end });

      if (statement.clause.kind === "namespace") {
        refusals.push({
          line: statement.startLine,
          snippet: `import * as ${statement.clause.namespaceName} from "${statement.specifier}"`,
          reason:
            "namespace import of the auth-client module. Member access through a " +
            "namespace binding is not traced by this scanner.",
        });
        continue;
      }
      if (statement.clause.kind === "unrecognized") {
        refusals.push({
          line: statement.startLine,
          snippet: `import ... from "${statement.specifier}"`,
          reason:
            "this import clause does not match any import shape this scanner parses.",
        });
        continue;
      }
      for (const entry of statement.clause.named ?? []) {
        if (entry.name !== exportName || entry.typeOnly) continue;
        rootAliasNames.add(entry.alias);
      }
    }

    // F9: the defining module itself never IMPORTS the export — it declares it — so it
    // never reaches `rootAliasNames` through the loop above, and without this seed the
    // file falls straight through the skip-gate below and is NEVER SCANNED AT ALL if
    // nothing else in it trips a top-level check. Found by a formal review, reproduced
    // live against the real checker: a plain `authClient.organization.setActive({...})`
    // placed directly in the definition file, right after its own `export const
    // authClient = createAuthClient(...)`, produced exit 0 / "0 live call sites" / zero
    // refusals — no obfuscation, no eval, no dynamic import, just an ordinary call in the
    // one file most likely to receive an ad-hoc "wire up a default org on load" during
    // this exact retrofit. An earlier version of this comment claimed "nothing extra is
    // needed here" and reasoned only about the declaration line itself not misfiring as a
    // false positive — true, but it never addressed that every OTHER line in the same
    // file was consequently never examined at all. Seeding the definition file's own
    // export name into `rootAliasNames` reuses the exact same `scanOccurrences` machinery
    // already proven correct for importing files; the existing `DECLARATION_KEYWORDS`
    // check in `scanOccurrences` (see its own comment) already correctly skips the
    // declaration line itself, so this seed cannot turn the declaration into a false
    // positive.
    if (absolute === definitionAbsolutePath) {
      rootAliasNames.add(exportName);
    }

    if (rootAliasNames.size === 0 && refusals.length === 0) continue;

    // `codeForScan` was already computed above (alongside `code`, before `findImportStatements`
    // — see the comment there for why the two passes' offsets stay interchangeable). Reused
    // here as `consumedRanges` against the alias/consumption scan below.
    const { orgAliases, consumedRanges } = findAliasCreations(
      codeForScan,
      rootAliasNames,
    );
    consumedRanges.push(...importRanges);

    const aliasKinds = new Map();
    for (const name of rootAliasNames) aliasKinds.set(name, "root");
    for (const name of orgAliases.keys()) aliasKinds.set(name, "org");

    const { calls, refusals: scanRefusals } = scanOccurrences(
      codeForScan,
      aliasKinds,
      consumedRanges,
    );

    const allRefusals = [...refusals, ...scanRefusals];
    if (calls.length > 0 || allRefusals.length > 0) {
      results.push({ file: absolute, calls, refusals: allRefusals });
    }
  }

  return results;
}

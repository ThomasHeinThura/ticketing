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
 * of the source tree. There is no list of "the 14 families" or "the files known to call
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
 *
 * None of these shapes exists in this repository today (verified by running this scanner
 * over `apps/web/src` at HEAD), which is exactly why the gate can ship green: the refusal
 * path is armed but silent until something actually needs it.
 */

import fs from "node:fs/promises";
import path from "node:path";
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

/**
 * Read `compilerOptions.paths` out of a tsconfig (JSONC — comments stripped first, no
 * dependency added) and turn it into ordered prefix → target-directory rules. This is
 * "derive the surface": the alias table a caller can use is exactly the one the real
 * compiler resolves against, never a hand-copied guess at what `@/` means.
 *
 * @returns {{ prefix: string, targetDir: string }[]} longest prefix first
 */
export async function loadPathAliases(tsconfigAbsolutePath) {
  const raw = await fs.readFile(tsconfigAbsolutePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(stripCodeComments(raw));
  } catch (error) {
    throw new OrganizationCallerScanUnavailableError(
      `${tsconfigAbsolutePath} could not be parsed as JSON once comments were stripped: ` +
        `${error.message}. Refusing to guess its path aliases.`,
    );
  }
  const paths = parsed.compilerOptions?.paths ?? {};
  const baseDir = path.dirname(tsconfigAbsolutePath);
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

const IMPORT_STATEMENT = /import\s+([^;]*?)\s+from\s*["']([^"']+)["'];?/g;

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
 * @returns {{ clause: ImportClause, specifier: string, startLine: number, endLine: number }[]}
 */
function findImportStatements(code) {
  const statements = [];
  IMPORT_STATEMENT.lastIndex = 0;
  for (
    let match = IMPORT_STATEMENT.exec(code);
    match !== null;
    match = IMPORT_STATEMENT.exec(code)
  ) {
    statements.push({
      clause: parseImportClause(match[1]),
      specifier: match[2],
      startLine: lineOf(code, match.index),
      endLine: lineOf(code, match.index + match[0].length),
    });
  }
  return statements;
}

// ── 4. Per-file alias discovery: import bindings, plus the two recognised local-alias
//      shapes for the `.organization` sub-client ──────────────────────────────────────

/**
 * `const NAME = <rootAlias>.organization;` and `const { organization[: NAME] } = <rootAlias>;`
 * — the only two ways this scanner will trace a further local alias. Anything else that
 * assigns `<rootAlias>` or `<rootAlias>.organization` to a new name is a refusal, raised
 * by the general scan below once these two patterns have claimed the lines they explain.
 *
 * @returns {{ orgAliases: Map<string, string>, consumedLines: Set<number> }} orgAliases
 *   maps local name -> the root alias it was derived from (informational only); consumedLines
 *   are line numbers these two patterns account for and the general scan must not re-examine.
 */
function findAliasCreations(code, rootAliasNames) {
  const orgAliases = new Map();
  const consumedLines = new Set();

  for (const root of rootAliasNames) {
    const escaped = escapeRegExp(root);

    const plain = new RegExp(
      `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escaped}\\s*(?:\\?\\.|\\.)\\s*organization\\s*[;\\n]`,
      "g",
    );
    for (let m = plain.exec(code); m !== null; m = plain.exec(code)) {
      orgAliases.set(m[1], root);
      const startLine = lineOf(code, m.index);
      const endLine = lineOf(code, m.index + m[0].length);
      for (let line = startLine; line <= endLine; line += 1)
        consumedLines.add(line);
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
        const startLine = lineOf(code, m.index);
        const endLine = lineOf(code, m.index + m[0].length);
        for (let line = startLine; line <= endLine; line += 1)
          consumedLines.add(line);
      }
    }
  }

  return { orgAliases, consumedLines };
}

// ── 5. The general occurrence scan ────────────────────────────────────────────────────

/**
 * @param {string} code comment-stripped, string-blanked source
 * @param {Map<string, "root"|"org">} aliasKinds
 * @param {Set<number>} consumedLines lines already explained (imports, alias creations)
 * @returns {{ calls: {family: string, line: number, snippet: string}[], refusals: {line: number, reason: string, snippet: string}[] }}
 */
function scanOccurrences(code, aliasKinds, consumedLines) {
  const calls = [];
  const refusals = [];
  if (aliasKinds.size === 0) return { calls, refusals };

  const alternation = [...aliasKinds.keys()].map(escapeRegExp).join("|");
  const pattern = new RegExp(`\\b(?:${alternation})\\b`, "g");

  for (
    let match = pattern.exec(code);
    match !== null;
    match = pattern.exec(code)
  ) {
    const name = match[0];
    const start = match.index;
    const end = start + name.length;
    const line = lineOf(code, start);
    if (consumedLines.has(line)) continue;

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
    if (!source.includes(exportName)) continue; // fast path: cannot mention the binding

    const code = stripCodeComments(source);
    const statements = findImportStatements(code);

    const rootAliasNames = new Set();
    const importLines = new Set();
    const refusals = [];

    for (const statement of statements) {
      const resolvedBase = resolveImportPath(
        absolute,
        statement.specifier,
        aliasRules,
      );
      if (resolvedBase === null) continue;
      const resolved = await resolveExistingFile(resolvedBase);
      if (resolved !== definitionAbsolutePath) continue;

      for (
        let line = statement.startLine;
        line <= statement.endLine;
        line += 1
      ) {
        importLines.add(line);
      }

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

    // The defining module itself never IMPORTS the export — it declares it — so it never
    // reaches `rootAliasNames` through the loop above. Its declaration line is still text
    // containing `exportName =`, which `scanOccurrences`'s declaration-keyword check skips
    // directly; nothing extra is needed here.

    if (rootAliasNames.size === 0 && refusals.length === 0) continue;

    const codeForScan = stripCodeComments(source, { blankStrings: true });
    const { orgAliases, consumedLines } = findAliasCreations(
      codeForScan,
      rootAliasNames,
    );
    for (const line of importLines) consumedLines.add(line);

    const aliasKinds = new Map();
    for (const name of rootAliasNames) aliasKinds.set(name, "root");
    for (const name of orgAliases.keys()) aliasKinds.set(name, "org");

    const { calls, refusals: scanRefusals } = scanOccurrences(
      codeForScan,
      aliasKinds,
      consumedLines,
    );

    const allRefusals = [...refusals, ...scanRefusals];
    if (calls.length > 0 || allRefusals.length > 0) {
      results.push({ file: absolute, calls, refusals: allRefusals });
    }
  }

  return results;
}

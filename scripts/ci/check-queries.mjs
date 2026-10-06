#!/usr/bin/env node
// biome-ignore-all lint/style/noParameterAssign: Scanner cursors are intentionally advanced in place.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finish, readText, repoRoot, violation, walk } from "./lib/repo.mjs";

const _apiRoot = path.join(repoRoot, "apps/api/src");

function readTokens(source) {
  const tokens = [];
  const identifierStart = /[$_\p{ID_Start}]/u;
  const identifierPart = /(?:[$_]|\u200c|\u200d|\p{ID_Continue})/u;
  const add = (value, offset, kind = "token") =>
    tokens.push({ value, offset, kind });

  function scanQuoted(index, quote) {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index] === quote) {
        add(source.slice(start + 1, index), start, "string");
        return index + 1;
      } else index += 1;
    }
    add(source.slice(start + 1), start, "string");
    return index;
  }

  function skipRegExp(index) {
    index += 1;
    let inCharacterClass = false;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
      } else if (source[index] === "[") {
        inCharacterClass = true;
        index += 1;
      } else if (source[index] === "]") {
        inCharacterClass = false;
        index += 1;
      } else if (source[index] === "/" && !inCharacterClass) {
        index += 1;
        while (index < source.length && identifierPart.test(source[index]))
          index += 1;
        return index;
      } else if (source[index] === "\n") {
        return index;
      } else {
        index += 1;
      }
    }
    return index;
  }

  function scanCode(index, stopAtBrace = false) {
    let braces = 0;
    while (index < source.length) {
      const ch = source[index];
      if (/\s/u.test(ch)) {
        index += 1;
        continue;
      }
      if (ch === "/" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        continue;
      }
      if (ch === "/" && source[index + 1] === "*") {
        index += 2;
        while (
          index < source.length &&
          !(source[index] === "*" && source[index + 1] === "/")
        )
          index += 1;
        index = Math.min(source.length, index + 2);
        continue;
      }
      const previous = tokens.at(-1)?.value;
      if (
        ch === "/" &&
        [
          undefined,
          "(",
          "[",
          "{",
          "=",
          ":",
          ",",
          ";",
          "!",
          "?",
          "=>",
          "return",
          "case",
          "throw",
          "&&",
          "||",
          "??",
        ].includes(previous)
      ) {
        index = skipRegExp(index);
        continue;
      }
      if (ch === "'" || ch === '"') {
        index = scanQuoted(index, ch);
        continue;
      }
      if (ch === "`") {
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
          } else if (source[index] === "`") {
            index += 1;
            break;
          } else if (source[index] === "$" && source[index + 1] === "{") {
            index = scanCode(index + 2, true);
          } else {
            index += 1;
          }
        }
        continue;
      }
      if (stopAtBrace && ch === "}" && braces === 0) return index + 1;
      if (identifierStart.test(ch)) {
        const start = index++;
        while (index < source.length && identifierPart.test(source[index]))
          index += 1;
        add(source.slice(start, index), start);
        continue;
      }
      if (ch === "{") braces += 1;
      else if (ch === "}" && braces > 0) braces -= 1;
      add(ch, index);
      index += 1;
    }
    return index;
  }

  scanCode(0);
  return tokens;
}

export function queryReadViolations(source, file) {
  const tokens = readTokens(source);
  const results = [];
  const seen = new Set();
  const readMethods = new Set([
    "select",
    "selectDistinct",
    "selectDistinctOn",
    "findFirst",
    "findMany",
    "findFirstOrThrow",
    "findManyOrThrow",
  ]);
  const methodBindings = readMethodBindings(tokens, readMethods);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (readMethods.has(token.value) && isCalledMember(tokens, index)) {
      addFinding(token.value, token.offset);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.kind === "token" &&
      methodBindings.has(token.value) &&
      !isMemberProperty(tokens, index) &&
      isCalled(tokens, index + 1)
    ) {
      addFinding(methodBindings.get(token.value), token.offset);
    }
  }

  return results.sort((a, b) => a.line - b.line);

  function addFinding(method, offset) {
    if (seen.has(offset)) return;
    seen.add(offset);
    const line = source.slice(0, offset).split("\n").length;
    results.push({ file, line, method });
  }
}

function isCalled(tokens, index) {
  return (
    tokens[index]?.value === "(" ||
    (tokens[index]?.value === "?" &&
      tokens[index + 1]?.value === "." &&
      tokens[index + 2]?.value === "(")
  );
}

function isMemberProperty(tokens, index) {
  if (tokens[index - 1]?.value === ".") return true;
  return tokens[index - 1]?.value === "[" && tokens[index + 1]?.value === "]";
}

function isCalledMember(tokens, index) {
  const token = tokens[index];
  if (!token || !(token.kind === "token" || token.kind === "string"))
    return false;
  if (tokens[index - 1]?.value === ".") return isCalled(tokens, index + 1);
  return (
    tokens[index - 1]?.value === "[" &&
    tokens[index + 1]?.value === "]" &&
    isCalled(tokens, index + 2)
  );
}

function isReadReferenceEnd(tokens, index) {
  const next = index + 1;
  if (tokens[next]?.value === ";" || tokens[next]?.value === ",") return true;

  const bindIndex =
    tokens[next]?.value === "."
      ? next + 1
      : tokens[next]?.value === "?" && tokens[next + 1]?.value === "."
        ? next + 2
        : -1;
  if (
    bindIndex < 0 ||
    tokens[bindIndex]?.value !== "bind" ||
    tokens[bindIndex + 1]?.value !== "("
  ) {
    return false;
  }

  let depth = 0;
  for (let cursor = bindIndex + 1; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].value === "(") depth += 1;
    else if (tokens[cursor].value === ")") {
      depth -= 1;
      if (depth === 0) {
        return [";", ","].includes(tokens[cursor + 1]?.value);
      }
    }
  }
  return false;
}

/**
 * Resolve simple local aliases of a read method, such as `const read = db.select`,
 * `const read = db.select.bind(db)`, and `const { select: read } = db`. This is deliberately lexical and bounded;
 * computed variable keys and interprocedural data flow are outside this gate's contract.
 */
function readMethodBindings(tokens, readMethods) {
  const bindings = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      !readMethods.has(token.value) ||
      !isMemberProperty(tokens, index) ||
      isCalled(tokens, index + 1)
    ) {
      continue;
    }
    if (
      isReadReferenceEnd(tokens, index) &&
      tokens[index - 3]?.value === "=" &&
      tokens[index - 4]?.kind === "token"
    ) {
      bindings.set(tokens[index - 4].value, token.value);
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (!["const", "let", "var"].includes(tokens[index].value)) continue;
    if (tokens[index + 1]?.value !== "{") continue;
    let cursor = index + 2;
    while (cursor < tokens.length && tokens[cursor].value !== "}") {
      const property = tokens[cursor];
      const alias =
        tokens[cursor + 1]?.value === ":" ? tokens[cursor + 2] : property;
      if (
        readMethods.has(property?.value) &&
        (property?.kind === "token" || property?.kind === "string") &&
        alias?.kind === "token"
      ) {
        bindings.set(alias.value, property.value);
      }
      while (
        cursor < tokens.length &&
        ![",", "}"].includes(tokens[cursor].value)
      ) {
        cursor += 1;
      }
      if (tokens[cursor]?.value === ",") cursor += 1;
    }
  }
  return bindings;
}

export async function checkQueries(root = repoRoot) {
  const sourceRoot = path.join(root, "apps/api/src");
  const violations = [];
  for (const file of await walk(sourceRoot)) {
    const relativeToSource = path.relative(sourceRoot, file);
    if (
      !file.endsWith(".ts") ||
      (path.basename(file) === "repository.ts" &&
        path.dirname(relativeToSource) !== ".")
    )
      continue;
    const relative = path.relative(root, file).split(path.sep).join("/");
    const source = await readText(file);
    for (const finding of queryReadViolations(source, relative)) {
      violations.push(finding);
    }
  }
  return violations;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await checkQueries();
  for (const finding of violations) {
    finding.message = violation(
      `${finding.file}:${finding.line}`,
      `Drizzle ${finding.method} read must be moved to the feature repository.ts`,
    );
  }
  finish({
    name: "check:queries",
    failures: violations.map(({ message }) => message),
    ok: "All recognized Drizzle read-method calls are owned by repository.ts files.",
  });
}

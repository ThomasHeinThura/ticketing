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
  const add = (value, offset) => tokens.push({ value, offset });

  function skipQuoted(index, quote) {
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index] === quote) return index + 1;
      else index += 1;
    }
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
        index = skipQuoted(index, ch);
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
  const readMethods = new Set([
    "select",
    "selectDistinct",
    "selectDistinctOn",
    "findFirst",
    "findMany",
    "findFirstOrThrow",
    "findManyOrThrow",
  ]);
  for (let index = 1; index + 1 < tokens.length; index += 1) {
    if (
      tokens[index - 1].value !== "." ||
      !readMethods.has(tokens[index].value) ||
      tokens[index + 1].value !== "("
    ) {
      continue;
    }
    const method = tokens[index].value;
    const line = source.slice(0, tokens[index].offset).split("\n").length;
    results.push({ file, line, method });
  }
  return results;
}

export async function checkQueries(root = repoRoot) {
  const sourceRoot = path.join(root, "apps/api/src");
  const violations = [];
  for (const file of await walk(sourceRoot)) {
    if (!file.endsWith(".ts") || path.basename(file) === "repository.ts")
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
    ok: "All API database read calls are owned by repository.ts files.",
  });
}

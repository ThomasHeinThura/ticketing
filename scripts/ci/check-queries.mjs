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
        const value = decodeStringLiteral(source.slice(start + 1, index));
        add(
          value ?? source.slice(start + 1, index),
          start,
          value === null ? "opaque-string" : "string",
        );
        return index + 1;
      } else index += 1;
    }
    add(source.slice(start + 1), start, "opaque-string");
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
      if (
        identifierStart.test(String.fromCodePoint(source.codePointAt(index))) ||
        (ch === "\\" && source[index + 1] === "u")
      ) {
        index = scanIdentifier(index);
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

  function scanIdentifier(index) {
    const start = index;
    let value = "";
    let first = true;
    while (index < source.length) {
      let character;
      let end;
      if (source[index] === "\\" && source[index + 1] === "u") {
        const escaped = readUnicodeEscape(source, index);
        if (!escaped) break;
        character = escaped.value;
        end = escaped.end;
      } else {
        const codePoint = source.codePointAt(index);
        if (codePoint === undefined) break;
        character = String.fromCodePoint(codePoint);
        end = index + character.length;
      }
      if (!(first ? identifierStart : identifierPart).test(character)) break;
      value += character;
      first = false;
      index = end;
    }
    if (!first) add(value, start);
    return first ? start + 1 : index;
  }
}

function readUnicodeEscape(source, index) {
  if (source[index] !== "\\" || source[index + 1] !== "u") return null;
  if (source[index + 2] === "{") {
    const end = source.indexOf("}", index + 3);
    if (end < 0) return null;
    const digits = source.slice(index + 3, end);
    if (!/^[\da-fA-F]{1,6}$/.test(digits)) return null;
    const point = Number.parseInt(digits, 16);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    return { value: String.fromCodePoint(point), end: end + 1 };
  }
  const digits = source.slice(index + 2, index + 6);
  if (!/^[\da-fA-F]{4}$/.test(digits)) return null;
  return {
    value: String.fromCharCode(Number.parseInt(digits, 16)),
    end: index + 6,
  };
}

function decodeStringLiteral(raw) {
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== "\\") {
      value += raw[index];
      continue;
    }
    index += 1;
    if (index >= raw.length) return null;
    const escaped = raw[index];
    if (escaped === "\n" || escaped === "\u2028" || escaped === "\u2029")
      continue;
    if (escaped === "\r") {
      if (raw[index + 1] === "\n") index += 1;
      continue;
    }
    if (escaped === "x") {
      const digits = raw.slice(index + 1, index + 3);
      if (!/^[\da-fA-F]{2}$/.test(digits)) return null;
      value += String.fromCharCode(Number.parseInt(digits, 16));
      index += 2;
      continue;
    }
    if (escaped === "u") {
      const decoded = readUnicodeEscape(raw, index - 1);
      if (!decoded) return null;
      value += decoded.value;
      index = decoded.end - 1;
      continue;
    }
    if (escaped === "0") {
      if (/\d/.test(raw[index + 1] ?? "")) return null;
      value += "\0";
      continue;
    }
    if (/^[1-9]$/.test(escaped)) return null;
    const simpleEscapes = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    value += simpleEscapes[escaped] ?? escaped;
  }
  return value;
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
 * dynamic variable keys and interprocedural data flow are outside this gate's contract.
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
      let property = tokens[cursor];
      let propertyEnd = cursor;
      if (
        property?.value === "[" &&
        tokens[cursor + 2]?.value === "]" &&
        tokens[cursor + 1]?.kind === "string"
      ) {
        property = tokens[cursor + 1];
        propertyEnd = cursor + 2;
      }
      const alias =
        tokens[propertyEnd + 1]?.value === ":"
          ? tokens[propertyEnd + 2]
          : property;
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

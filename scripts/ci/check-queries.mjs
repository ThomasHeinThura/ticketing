#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { finish, readText, repoRoot, violation, walk } from "./lib/repo.mjs";

const readMethods = new Set([
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "findFirst",
  "findMany",
  "findFirstOrThrow",
  "findManyOrThrow",
]);
const memberTypes = new Set(["MemberExpression", "OptionalMemberExpression"]);
const callTypes = new Set(["CallExpression", "OptionalCallExpression"]);

function unwrap(input) {
  let node = input;
  while (
    node &&
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TSSatisfiesExpression",
      "TSInstantiationExpression",
      "TypeCastExpression",
    ].includes(node.type)
  ) {
    node = node.expression;
  }
  return node;
}

function propertyName(member) {
  if (!memberTypes.has(member?.type)) return null;
  if (!member.computed && member.property?.type === "Identifier")
    return member.property.name;
  return staticStringValue(member.property);
}

function staticStringValue(input) {
  const value = unwrap(input);
  if (value?.type === "StringLiteral") return value.value;
  if (value?.type === "TemplateLiteral" && value.expressions.length === 0) {
    const cooked = value.quasis[0]?.value.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

function isMember(node, name) {
  return memberTypes.has(node?.type) && propertyName(node) === name;
}

function referenceMethod(input, aliases) {
  const node = unwrap(input);
  if (memberTypes.has(node?.type)) {
    const name = propertyName(node);
    if (readMethods.has(name)) return name;
    return null;
  }
  if (node?.type === "Identifier") return aliases.get(node.name) ?? null;
  return null;
}

function callableReferenceMethod(input, aliases) {
  const node = unwrap(input);
  if (memberTypes.has(node?.type)) {
    const name = propertyName(node);
    return readMethods.has(name) ? name : null;
  }
  if (node?.type === "Identifier") return aliases.get(node.name) ?? null;
  if (callTypes.has(node?.type) && isMember(unwrap(node.callee), "bind")) {
    return callableReferenceMethod(unwrap(node.callee).object, aliases);
  }
  return null;
}

function boundReferenceMethod(input, aliases) {
  const node = unwrap(input);
  if (callTypes.has(node?.type) && isMember(unwrap(node.callee), "bind")) {
    return callableReferenceMethod(unwrap(node.callee).object, aliases);
  }
  return referenceMethod(node, aliases);
}

function destructuredBindings(input, aliases) {
  const pattern = unwrap(input);
  if (pattern?.type !== "ObjectPattern") return false;
  let changed = false;
  for (const item of pattern.properties) {
    if (item.type !== "ObjectProperty") continue;
    const name = item.computed ? staticStringValue(item.key) : item.key?.name;
    const target = unwrap(item.value);
    if (readMethods.has(name) && target?.type === "Identifier") {
      aliases.set(target.name, name);
      changed = true;
    }
  }
  return changed;
}

function collectAliases(ast) {
  const aliases = new Map();
  const declarations = [];
  visit(ast, (node) => {
    if (node.type === "VariableDeclarator") declarations.push(node);
  });
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const pattern = unwrap(declaration.id);
      if (pattern?.type === "Identifier") {
        const method = boundReferenceMethod(declaration.init, aliases);
        if (method && aliases.get(pattern.name) !== method) {
          aliases.set(pattern.name, method);
          changed = true;
        }
      } else if (destructuredBindings(pattern, aliases)) {
        changed = true;
      }
    }
    if (!changed) break;
  }
  return aliases;
}

function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) visit(child, callback);
    return;
  }
  if (typeof value.type === "string") callback(value);
  for (const [key, child] of Object.entries(value)) {
    if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
      continue;
    if (child && typeof child === "object") visit(child, callback);
  }
}

export function queryReadViolations(source, file) {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: false,
      createParenthesizedExpressions: true,
      plugins: ["typescript", "jsx"],
    });
  } catch (error) {
    const line = Number.isInteger(error.loc?.line) ? error.loc.line : 1;
    return [{ file, line, method: "parse error" }];
  }

  const aliases = collectAliases(ast);
  const byOffset = new Map();
  visit(ast, (node) => {
    if (!callTypes.has(node.type)) return;
    const callee = unwrap(node.callee);
    if (memberTypes.has(callee?.type)) {
      const name = propertyName(callee);
      if (readMethods.has(name)) {
        add(name, callee.property.start);
        return;
      }
      if (["bind", "call", "apply"].includes(name)) {
        if (name === "bind") return;
        const method = callableReferenceMethod(callee.object, aliases);
        if (method)
          add(
            method,
            unwrap(callee.object).property?.start ?? callee.object.start,
          );
        return;
      }
    }
    const method = boundReferenceMethod(callee, aliases);
    if (method) {
      const origin = originNode(callee, aliases);
      add(method, origin?.start ?? callee.start);
    }
  });

  return [...byOffset.entries()]
    .sort(([left], [right]) => left - right)
    .map(([offset, method]) => ({
      file,
      line: source.slice(0, offset).split("\n").length,
      method,
    }));

  function add(method, offset) {
    if (method && Number.isInteger(offset) && !byOffset.has(offset))
      byOffset.set(offset, method);
  }
}

function originNode(input, aliases) {
  const node = unwrap(input);
  if (callTypes.has(node?.type) && isMember(unwrap(node.callee), "bind"))
    return originNode(unwrap(node.callee).object, aliases);
  if (node?.type === "Identifier" && aliases.has(node.name)) return node;
  if (memberTypes.has(node?.type) && readMethods.has(propertyName(node)))
    return node.property;
  return node;
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
    violations.push(...queryReadViolations(await readText(file), relative));
  }
  return violations;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await checkQueries();
  for (const finding of violations) {
    finding.message =
      finding.method === "parse error"
        ? violation(
            `${finding.file}:${finding.line}`,
            "TypeScript source must parse before the query ownership gate can run",
          )
        : violation(
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

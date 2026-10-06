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

function collectStaticBindings(ast) {
  const nodeScopes = new WeakMap();
  const rootScope = { parent: null, bindings: new Map(), functionScope: null };
  rootScope.functionScope = rootScope;

  function childScope(parent, isFunction = false) {
    const scope = {
      parent,
      bindings: new Map(),
      functionScope: null,
    };
    scope.functionScope = isFunction ? scope : parent.functionScope;
    return scope;
  }

  function addBinding(scope, name, binding) {
    if (!name) return;
    scope.bindings.set(name, { ...binding, name, scope });
  }

  function addPattern(
    scope,
    pattern,
    binding,
    path = null,
    destructured = false,
  ) {
    const node = unwrap(pattern);
    if (!node) return;
    if (node.type === "Identifier") {
      addBinding(scope, node.name, { ...binding, path, destructured });
      return;
    }
    if (node.type === "TSParameterProperty") {
      addPattern(scope, node.parameter, binding, path, destructured);
      return;
    }
    if (node.type === "AssignmentPattern") {
      addPattern(scope, node.left, binding, path, destructured);
      return;
    }
    if (node.type === "RestElement") {
      addPattern(scope, node.argument, binding, null, true);
      return;
    }
    if (node.type === "ObjectPattern") {
      for (const property of node.properties) {
        if (property.type === "RestElement") {
          addPattern(scope, property.argument, binding, null, true);
          continue;
        }
        if (property.type !== "ObjectProperty") continue;
        const key = property.computed
          ? staticStringValue(property.key)
          : property.key?.name;
        const nextPath =
          key === undefined || key === null ? null : [...(path ?? []), key];
        addPattern(scope, property.value, binding, nextPath, true);
      }
      return;
    }
    if (node.type === "ArrayPattern") {
      for (const element of node.elements)
        addPattern(scope, element, binding, null, true);
    }
  }

  function walk(node, scope) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, scope);
      return;
    }
    if (typeof node.type !== "string") return;
    let activeScope = scope;

    if (node.type === "Program") {
      nodeScopes.set(node, scope);
      for (const statement of node.body) walk(statement, scope);
      return;
    }

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      if (node.type === "FunctionDeclaration" && node.id) {
        addBinding(scope, node.id.name, { kind: "declaration" });
      }
      const functionScope = childScope(scope, true);
      if (node.id) {
        nodeScopes.set(node.id, functionScope);
        if (node.type !== "FunctionDeclaration") {
          addBinding(functionScope, node.id.name, { kind: "declaration" });
        }
      }
      nodeScopes.set(node, functionScope);
      for (const parameter of node.params ?? []) {
        addPattern(functionScope, parameter, { kind: "parameter" });
        walk(parameter, functionScope);
      }
      if (node.body) walk(node.body, functionScope);
      return;
    }

    if (node.type === "BlockStatement") {
      activeScope = childScope(scope);
    } else if (node.type === "CatchClause") {
      activeScope = childScope(scope);
      addPattern(activeScope, node.param, { kind: "parameter" });
    } else if (
      [
        "ForStatement",
        "ForInStatement",
        "ForOfStatement",
        "SwitchStatement",
      ].includes(node.type)
    ) {
      activeScope = childScope(scope);
    } else if (
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    ) {
      if (node.type === "ClassDeclaration" && node.id) {
        addBinding(scope, node.id.name, { kind: "declaration" });
      }
      activeScope = childScope(scope);
      if (node.id && node.type === "ClassExpression") {
        addBinding(activeScope, node.id.name, { kind: "declaration" });
      }
    }

    nodeScopes.set(node, activeScope);
    if (node.type === "VariableDeclaration") {
      const targetScope =
        node.kind === "var" ? activeScope.functionScope : activeScope;
      for (const declaration of node.declarations) {
        addPattern(targetScope, declaration.id, {
          kind: node.kind,
          initializer: declaration.init,
          declarationScope: activeScope,
        });
      }
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        addBinding(activeScope, specifier.local.name, { kind: "declaration" });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        continue;
      if (value && typeof value === "object") walk(value, activeScope);
    }
  }

  walk(ast, rootScope);
  return { nodeScopes, rootScope };
}

function resolveStaticValue(input, scope, bindings, seen = new Set()) {
  const node = unwrap(input);
  if (!node) return null;

  if (node.type === "SequenceExpression") {
    return resolveStaticValue(node.expressions.at(-1), scope, bindings, seen);
  }

  if (node.type === "Identifier") {
    let currentScope = scope;
    let binding = null;
    while (currentScope) {
      binding = currentScope.bindings.get(node.name) ?? null;
      if (binding) break;
      currentScope = currentScope.parent;
    }
    if (!binding) {
      if (node.name === "Reflect") return { kind: "reflect", origin: node };
      if (node.name === "globalThis")
        return { kind: "globalThis", origin: node };
      return null;
    }
    if (
      binding.kind !== "const" ||
      (binding.destructured && !binding.path) ||
      seen.has(binding)
    ) {
      return null;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(binding);
    if (binding.path) {
      const base = resolveStaticValue(
        binding.initializer,
        binding.declarationScope,
        bindings,
        nextSeen,
      );
      return projectStaticValue(base, binding.path, node);
    }
    return resolveStaticValue(
      binding.initializer,
      binding.declarationScope,
      bindings,
      nextSeen,
    );
  }

  if (memberTypes.has(node.type)) {
    const name = propertyName(node);
    const object = resolveStaticValue(
      node.object,
      bindings.nodeScopes.get(node.object) ?? scope,
      bindings,
      seen,
    );
    if (object?.kind === "globalThis" && name === "Reflect") {
      return { kind: "reflect", origin: node.property };
    }
    if (object?.kind === "reflect" && name === "apply") {
      return { kind: "reflectApply", boundArgs: [], origin: node.property };
    }
    if (object?.kind === "reflect" || object?.kind === "globalThis")
      return null;
    if (readMethods.has(name))
      return { kind: "queryRead", method: name, origin: node.property };
    return null;
  }

  if (callTypes.has(node.type)) {
    const callee = unwrap(node.callee);
    if (memberTypes.has(callee?.type) && propertyName(callee) === "bind") {
      const target = resolveStaticValue(
        callee.object,
        bindings.nodeScopes.get(callee.object) ?? scope,
        bindings,
        seen,
      );
      if (target?.kind === "queryRead") return target;
      if (target?.kind === "reflectApply") {
        return {
          ...target,
          boundArgs: [...target.boundArgs, ...node.arguments.slice(1)],
        };
      }
    }
  }

  return null;
}

function projectStaticValue(base, path, origin) {
  if (!path?.length) return null;
  let value = base;
  for (const name of path) {
    if (value?.kind === "globalThis" && name === "Reflect") {
      value = { kind: "reflect", origin };
    } else if (value?.kind === "reflect" && name === "apply") {
      value = { kind: "reflectApply", boundArgs: [], origin };
    } else if (!value && readMethods.has(name)) {
      value = { kind: "queryRead", method: name, origin };
    } else {
      return null;
    }
  }
  return value;
}

function reflectApplyTarget(call, bindings) {
  const scope = bindings.nodeScopes.get(call) ?? bindings.rootScope;
  const callee = unwrap(call.callee);
  const direct = resolveStaticValue(
    callee,
    bindings.nodeScopes.get(callee) ?? scope,
    bindings,
  );
  if (direct?.kind === "reflectApply") {
    return [...direct.boundArgs, ...call.arguments][0] ?? null;
  }

  if (!memberTypes.has(callee?.type)) return null;
  const forwarder = propertyName(callee);
  if (!["call", "apply"].includes(forwarder)) return null;
  const target = resolveStaticValue(
    callee.object,
    bindings.nodeScopes.get(callee.object) ?? scope,
    bindings,
  );
  if (target?.kind !== "reflectApply") return null;

  if (forwarder === "call") {
    return [...target.boundArgs, ...call.arguments.slice(1)][0] ?? null;
  }
  const forwarded = unwrap(call.arguments[1]);
  if (forwarded?.type !== "ArrayExpression") return null;
  return [...target.boundArgs, ...forwarded.elements][0] ?? null;
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
  const bindings = collectStaticBindings(ast);
  const byOffset = new Map();
  visit(ast, (node) => {
    if (!callTypes.has(node.type)) return;
    const callee = unwrap(node.callee);
    const appliedTarget = reflectApplyTarget(node, bindings);
    if (appliedTarget) {
      const target = resolveStaticValue(
        appliedTarget,
        bindings.nodeScopes.get(appliedTarget) ?? bindings.rootScope,
        bindings,
      );
      if (target?.kind === "queryRead") {
        add(target.method, target.origin?.start ?? appliedTarget.start);
      }
    }
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

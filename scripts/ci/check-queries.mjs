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

function isDatabaseModule(source) {
  return typeof source === "string" && /(?:^|\/)database(?:\/|$)/u.test(source);
}

function hasDatabaseTypeAnnotation(input) {
  const node = unwrap(
    input?.type === "TSTypeAnnotation" ? input.typeAnnotation : input,
  );
  if (!node) return false;
  if (node.type === "TSUnionType" || node.type === "TSIntersectionType") {
    return node.types.some(hasDatabaseTypeAnnotation);
  }
  if (node.type === "TSParenthesizedType")
    return hasDatabaseTypeAnnotation(node.typeAnnotation);
  if (node.type !== "TSTypeReference") return false;
  const typeName = unwrap(node.typeName);
  if (typeName?.type !== "Identifier") return false;
  return (
    typeName.name === "DatabaseInstance" ||
    typeName.name === "DbOrTx" ||
    typeName.name === "DbTransaction" ||
    typeName.name.endsWith("Transaction")
  );
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
        addPattern(functionScope, parameter, {
          kind: "parameter",
          database: hasDatabaseTypeAnnotation(parameter.typeAnnotation),
        });
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
        addBinding(activeScope, specifier.local.name, {
          kind: "import",
          database:
            node.importKind !== "type" &&
            specifier.importKind !== "type" &&
            isDatabaseModule(node.source?.value),
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        continue;
      if (value && typeof value === "object") walk(value, activeScope);
    }
  }

  walk(ast, rootScope);
  const bindings = { nodeScopes, rootScope };
  visit(ast, (node) => {
    if (!callTypes.has(node.type)) return;
    const callee = unwrap(node.callee);
    const transactionCall = resolveStaticValue(
      callee,
      nodeScopes.get(callee) ?? rootScope,
      bindings,
    );
    if (transactionCall?.kind !== "transactionMethod") return;
    const callback = unwrap(node.arguments?.[0]);
    if (
      !["FunctionExpression", "ArrowFunctionExpression"].includes(
        callback?.type,
      )
    ) {
      return;
    }
    const callbackScope = nodeScopes.get(callback);
    for (const parameter of callback.params ?? []) {
      const identifiers = [];
      visit(parameter, (candidate) => {
        if (candidate.type === "Identifier") identifiers.push(candidate);
      });
      for (const identifier of identifiers) {
        const binding = callbackScope?.bindings.get(identifier.name);
        if (binding) binding.database = true;
      }
    }
  });
  return bindings;
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
      if (["db", "tx", "dbOrTx"].includes(node.name)) {
        return { kind: "database", path: [] };
      }
      return null;
    }
    if (binding.database) {
      const database = { kind: "database", path: [] };
      return binding.path
        ? projectStaticValue(database, binding.path, node)
        : database;
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
    if (object?.kind === "database" && readMethods.has(name)) {
      return { kind: "queryRead", method: name, origin: node.property };
    }
    if (object?.kind === "database") {
      if (name === "transaction") return { kind: "transactionMethod" };
      return {
        kind: "database",
        path: name === null ? null : [...(object.path ?? []), name],
      };
    }
    return null;
  }

  if (callTypes.has(node.type)) {
    const callee = unwrap(node.callee);
    if (memberTypes.has(callee?.type) && propertyName(callee) === "bind")
      return resolveStaticValue(
        callee.object,
        bindings.nodeScopes.get(callee.object) ?? scope,
        bindings,
        seen,
      );
  }

  return null;
}

function projectStaticValue(base, path, origin) {
  if (!path?.length) return null;
  let value = base;
  for (const name of path) {
    if (value?.kind === "database" && readMethods.has(name)) {
      value = { kind: "queryRead", method: name, origin };
    } else if (value?.kind === "database" && name === "transaction") {
      value = { kind: "transactionMethod" };
    } else if (value?.kind === "database") {
      value = {
        kind: "database",
        path: [...(value.path ?? []), name],
      };
    } else {
      return null;
    }
  }
  return value;
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

  const bindings = collectStaticBindings(ast);
  const byOffset = new Map();
  // Enforce ownership at the database method lookup. That static reference remains
  // visible when a caller stores, extracts, or forwards it through arbitrary wrappers,
  // so this gate intentionally does not model JavaScript invocation semantics.
  visit(ast, (node) => {
    const scope = bindings.nodeScopes.get(node) ?? bindings.rootScope;
    if (memberTypes.has(node.type)) {
      const value = resolveStaticValue(node, scope, bindings);
      if (value?.kind === "queryRead") {
        add(value.method, value.origin?.start ?? node.property.start);
      }
    } else if (node.type === "ObjectPattern") {
      visit(node, (identifier) => {
        if (identifier.type !== "Identifier") return;
        const value = resolveStaticValue(
          identifier,
          bindings.nodeScopes.get(identifier) ?? scope,
          bindings,
        );
        if (value?.kind === "queryRead") {
          add(value.method, value.origin?.start ?? identifier.start);
        }
      });
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

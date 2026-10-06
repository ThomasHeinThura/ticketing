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
  return (
    typeof source === "string" && /(?:^|\/)database(?:\/index)?$/u.test(source)
  );
}

function hasDatabaseTypeAnnotation(
  input,
  databaseTypeNames,
  databaseTransactionTypes,
) {
  const node = unwrap(
    input?.type === "TSTypeAnnotation" ? input.typeAnnotation : input,
  );
  if (!node) return false;
  if (node.type === "TSUnionType" || node.type === "TSIntersectionType") {
    return node.types.some((member) =>
      hasDatabaseTypeAnnotation(
        member,
        databaseTypeNames,
        databaseTransactionTypes,
      ),
    );
  }
  if (node.type === "TSParenthesizedType")
    return hasDatabaseTypeAnnotation(
      node.typeAnnotation,
      databaseTypeNames,
      databaseTransactionTypes,
    );
  if (node.type !== "TSTypeReference") return false;
  const typeName = unwrap(node.typeName);
  if (typeName?.type !== "Identifier") return false;
  return (
    databaseTypeNames.has(typeName.name) ||
    databaseTransactionTypes.has(typeName.name)
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

function isDatabaseTransactionType(input, databaseBindings, databaseTypeNames) {
  let found = false;
  visit(input, (node) => {
    if (node.type === "TSTypeQuery") {
      const expression = unwrap(node.exprName);
      const object =
        expression?.type === "TSQualifiedName"
          ? unwrap(expression.left)
          : unwrap(expression?.object);
      if (
        ((memberTypes.has(expression?.type) &&
          propertyName(expression) === "transaction") ||
          (expression?.type === "TSQualifiedName" &&
            expression.right?.name === "transaction")) &&
        object?.type === "Identifier" &&
        databaseBindings.has(object.name)
      ) {
        found = true;
      }
      return;
    }
    if (node.type === "TSIndexedAccessType") {
      const objectType = unwrap(node.objectType);
      const typeName = unwrap(objectType?.typeName);
      const indexType = unwrap(node.indexType);
      if (
        staticStringValue(indexType?.literal ?? indexType) === "transaction" &&
        objectType?.type === "TSTypeReference" &&
        typeName?.type === "Identifier" &&
        databaseTypeNames.has(typeName.name)
      ) {
        found = true;
      }
    }
  });
  return found;
}

function collectStaticBindings(ast) {
  const nodeScopes = new WeakMap();
  const parents = new WeakMap();
  const databaseBindings = new Set();
  const databaseTypeNames = new Set();
  const databaseTransactionTypes = new Set();
  visit(ast, (node) => {
    if (
      node.type !== "ImportDeclaration" ||
      !isDatabaseModule(node.source?.value)
    )
      return;
    for (const specifier of node.specifiers) {
      if (specifier.type === "ImportDefaultSpecifier") {
        databaseBindings.add(specifier.local.name);
      }
      if (specifier.type === "ImportSpecifier") {
        const importedName =
          specifier.imported?.name ?? specifier.imported?.value;
        if (importedName === "DatabaseInstance")
          databaseTypeNames.add(specifier.local.name);
      }
    }
  });
  visit(ast, (node) => {
    if (
      node.type !== "ImportDeclaration" ||
      !/(?:^|\/)events\/outbox$/u.test(node.source?.value ?? "")
    ) {
      return;
    }
    for (const specifier of node.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const importedName =
        specifier.imported?.name ?? specifier.imported?.value;
      if (importedName === "DbTransaction")
        databaseTransactionTypes.add(specifier.local.name);
    }
  });
  visit(ast, (node) => {
    if (
      node.type === "TSTypeAliasDeclaration" &&
      isDatabaseTransactionType(
        node.typeAnnotation,
        databaseBindings,
        databaseTypeNames,
      )
    ) {
      databaseTransactionTypes.add(node.id.name);
    }
  });
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

  function walk(node, scope, parent = null) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, scope, parent);
      return;
    }
    if (typeof node.type !== "string") return;
    if (parent) parents.set(node, parent);
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
          database: hasDatabaseTypeAnnotation(
            parameter.typeAnnotation,
            databaseTypeNames,
            databaseTransactionTypes,
          ),
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
            specifier.type === "ImportDefaultSpecifier" &&
            node.importKind !== "type" &&
            specifier.importKind !== "type" &&
            isDatabaseModule(node.source?.value),
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        continue;
      if (value && typeof value === "object") walk(value, activeScope, node);
    }
  }

  walk(ast, rootScope);
  const bindings = { nodeScopes, parents, rootScope };
  visit(ast, (node) => {
    if (!callTypes.has(node.type)) return;
    const callee = unwrap(node.callee);
    if (
      !memberTypes.has(callee?.type) ||
      propertyName(callee) !== "transaction" ||
      resolveStaticValue(
        callee.object,
        nodeScopes.get(callee.object) ?? rootScope,
        bindings,
      )?.kind !== "database"
    ) {
      return;
    }
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
  // Read-method ownership is enforced at lookup. Transaction orchestration is the
  // bounded exception: only a direct call with an inline callback may remain outside
  // the repository; every other statically known transaction-method reference escapes.
  visit(ast, (node) => {
    const scope = bindings.nodeScopes.get(node) ?? bindings.rootScope;
    if (memberTypes.has(node.type)) {
      const value = resolveStaticValue(node, scope, bindings);
      if (value?.kind === "queryRead") {
        add(value.method, value.origin?.start ?? node.property.start);
      } else if (value?.kind === "transactionMethod") {
        const parent = bindings.parents.get(node);
        const callback = unwrap(parent?.arguments?.[0]);
        const isDirectInlineTransactionCall =
          callTypes.has(parent?.type) &&
          unwrap(parent.callee) === node &&
          ["FunctionExpression", "ArrowFunctionExpression"].includes(
            callback?.type,
          );
        if (!isDirectInlineTransactionCall) {
          add("transaction", node.property.start);
        }
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
        } else if (value?.kind === "transactionMethod") {
          add("transaction", identifier.start);
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

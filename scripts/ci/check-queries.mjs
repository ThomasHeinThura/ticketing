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
    typeof source === "string" &&
    source.startsWith(".") &&
    /(?:^|\/)database(?:\/index)?$/u.test(source)
  );
}

function isOutboxModule(source) {
  return (
    typeof source === "string" &&
    source.startsWith(".") &&
    /(?:^|\/)events\/outbox$/u.test(source)
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

function directCallForCallee(expression, parents) {
  let current = expression;
  let parent = parents.get(current);
  while (
    parent &&
    [
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSTypeAssertion",
      "TSNonNullExpression",
      "TSSatisfiesExpression",
      "TSInstantiationExpression",
      "TypeCastExpression",
    ].includes(parent.type)
  ) {
    current = parent;
    parent = parents.get(current);
  }
  if (callTypes.has(parent?.type) && unwrap(parent.callee) === expression) {
    return parent;
  }
  return null;
}

function typeNameParts(input) {
  const node = unwrap(input);
  if (node?.type === "Identifier") return [node.name];
  if (node?.type === "TSQualifiedName")
    return [...typeNameParts(node.left), node.right.name];
  return [];
}

// Follow only registered roots and transparent aliases needed by this gate.
function resolveDatabaseType(
  input,
  scope,
  bindings,
  seenAliases = new Set(),
  substitutions = new Map(),
  seenSubstitutions = new Set(),
) {
  const node = unwrap(
    input?.type === "TSTypeAnnotation" ? input.typeAnnotation : input,
  );
  if (!node) return null;

  if (node.type === "TSUnionType" || node.type === "TSIntersectionType") {
    for (const member of node.types) {
      const kind = resolveDatabaseType(
        member,
        scope,
        bindings,
        seenAliases,
        substitutions,
        seenSubstitutions,
      );
      if (kind) return kind;
    }
    return null;
  }
  if (node.type === "TSParenthesizedType")
    return resolveDatabaseType(
      node.typeAnnotation,
      scope,
      bindings,
      seenAliases,
      substitutions,
      seenSubstitutions,
    );

  if (node.type === "TSTypeQuery") {
    const parts = typeNameParts(node.exprName);
    if (parts.length === 1) {
      const value = resolveStaticValue(
        { type: "Identifier", name: parts[0] },
        scope,
        bindings,
      );
      return value?.kind === "database" ? "database" : null;
    }
    if (parts.length === 2 && parts[1] === "transaction") {
      const value = resolveStaticValue(
        { type: "Identifier", name: parts[0] },
        scope,
        bindings,
      );
      return value?.kind === "database" ? "transactionMethod" : null;
    }
    return null;
  }

  if (node.type === "TSIndexedAccessType") {
    const index = unwrap(node.indexType);
    const property = staticStringValue(index?.literal ?? index);
    if (
      property === "transaction" &&
      resolveDatabaseType(
        node.objectType,
        scope,
        bindings,
        seenAliases,
        substitutions,
        seenSubstitutions,
      ) === "database"
    ) {
      return "transactionMethod";
    }
    const objectType = unwrap(node.objectType);
    const objectName = unwrap(objectType?.typeName);
    if (
      index?.type === "TSLiteralType" &&
      index.literal?.type === "NumericLiteral" &&
      objectType?.type === "TSTypeReference" &&
      objectName?.type === "Identifier" &&
      objectName.name === "Parameters"
    ) {
      const parametersKind = resolveDatabaseType(
        objectType,
        scope,
        bindings,
        seenAliases,
        substitutions,
        seenSubstitutions,
      );
      if (parametersKind === "transactionMethodParameters")
        return "transactionCallback";
      if (parametersKind === "transactionCallbackParameters")
        return "transaction";
    }
    return null;
  }

  if (node.type !== "TSTypeReference") return null;
  const nameNode = unwrap(node.typeName);
  if (nameNode?.type !== "Identifier") return null;

  let typeScope = scope;
  let typeBinding;
  while (typeScope) {
    typeBinding = typeScope.typeBindings.get(nameNode.name);
    if (typeBinding) break;
    typeScope = typeScope.parent;
  }
  if (typeBinding?.kind === "typeParameter") {
    const substitution = substitutions.get(typeBinding);
    if (!substitution || seenSubstitutions.has(typeBinding)) return null;
    const nextSeen = new Set(seenSubstitutions);
    nextSeen.add(typeBinding);
    return resolveDatabaseType(
      substitution.input,
      substitution.scope,
      bindings,
      seenAliases,
      substitutions,
      nextSeen,
    );
  }
  if (typeBinding?.kind === "databaseTypeRoot") return "database";
  if (typeBinding?.kind === "transactionTypeRoot") return "transaction";
  if (typeBinding) {
    if (typeBinding.kind !== "typeAlias") return null;
    // A nested instantiation may use the same alias more than once (Id<Id<T>>).
    // Stop only when expansion revisits the same source reference in a cycle.
    if (seenAliases.has(node)) return null;
    const nextSeen = new Set(seenAliases);
    nextSeen.add(node);
    const nextSubstitutions = new Map(substitutions);
    const parameters = typeBinding.typeParameterBindings ?? [];
    const arguments_ = node.typeParameters?.params ?? [];
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const argument = arguments_[index];
      if (argument) {
        nextSubstitutions.set(parameter, {
          input: argument,
          scope,
        });
      } else if (parameter.node.default) {
        nextSubstitutions.set(parameter, {
          input: parameter.node.default,
          scope: typeBinding.typeParameterScope,
        });
      }
    }
    return resolveDatabaseType(
      typeBinding.typeAnnotation,
      typeBinding.scope,
      bindings,
      nextSeen,
      nextSubstitutions,
      new Set(),
    );
  }

  if (nameNode.name === "Parameters") {
    const parameter = node.typeParameters?.params?.[0];
    const kind = resolveDatabaseType(
      parameter,
      scope,
      bindings,
      seenAliases,
      substitutions,
      seenSubstitutions,
    );
    if (kind === "transactionMethod") return "transactionMethodParameters";
    if (kind === "transactionCallback") return "transactionCallbackParameters";
    return null;
  }

  // These standard wrappers preserve the underlying executor identity.
  if (
    ["ReturnType", "Pick", "Omit", "Partial", "Required", "Readonly"].includes(
      nameNode.name,
    )
  ) {
    for (const parameter of node.typeParameters?.params ?? []) {
      const kind = resolveDatabaseType(
        parameter,
        scope,
        bindings,
        seenAliases,
        substitutions,
        seenSubstitutions,
      );
      if (kind) return kind;
    }
  }
  return null;
}

function collectStaticBindings(ast) {
  const nodeScopes = new WeakMap();
  const parents = new WeakMap();
  const rootScope = {
    parent: null,
    bindings: new Map(),
    typeBindings: new Map(),
    functionScope: null,
  };
  rootScope.functionScope = rootScope;
  const scopes = [rootScope];

  function childScope(parent, isFunction = false) {
    const scope = {
      parent,
      bindings: new Map(),
      typeBindings: new Map(),
      functionScope: null,
    };
    scope.functionScope = isFunction ? scope : parent.functionScope;
    scopes.push(scope);
    return scope;
  }

  function addBinding(scope, name, binding) {
    if (!name) return;
    scope.bindings.set(name, { ...binding, name, scope });
  }

  function addTypeBinding(scope, name, binding) {
    if (!name) return;
    const resolved = { ...binding, name, scope };
    scope.typeBindings.set(name, resolved);
    return resolved;
  }

  function addTypeParameters(scope, declaration) {
    const bindings = [];
    for (const parameter of declaration?.params ?? []) {
      if (parameter.type !== "TSTypeParameter" || !parameter.name) continue;
      const binding = {
        kind: "typeParameter",
        name: parameter.name,
        scope,
        node: parameter,
      };
      scope.typeBindings.set(parameter.name, binding);
      bindings.push(binding);
    }
    return bindings;
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
      addTypeParameters(functionScope, node.typeParameters);
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
          database: false,
          typeAnnotation: parameter.typeAnnotation,
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
      addTypeParameters(activeScope, node.typeParameters);
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
        const source = node.source?.value;
        const isDatabase = isDatabaseModule(source);
        const isOutbox = isOutboxModule(source);
        addBinding(activeScope, specifier.local.name, {
          kind: "import",
          database:
            specifier.type === "ImportDefaultSpecifier" &&
            node.importKind !== "type" &&
            specifier.importKind !== "type" &&
            isDatabase,
        });
        if (isDatabase && specifier.type === "ImportSpecifier") {
          const importedName =
            specifier.imported?.name ?? specifier.imported?.value;
          if (importedName === "DatabaseInstance") {
            addTypeBinding(activeScope, specifier.local.name, {
              kind: "databaseTypeRoot",
            });
          }
        }
        if (isOutbox && specifier.type === "ImportSpecifier") {
          const importedName =
            specifier.imported?.name ?? specifier.imported?.value;
          if (importedName === "DbTransaction") {
            addTypeBinding(activeScope, specifier.local.name, {
              kind: "transactionTypeRoot",
            });
          }
        }
      }
    } else if (node.type === "TSTypeAliasDeclaration") {
      const alias = addTypeBinding(activeScope, node.id?.name, {
        kind: "typeAlias",
        typeAnnotation: node.typeAnnotation,
        typeParameters: node.typeParameters,
      });
      const typeParameterScope = childScope(activeScope);
      alias.scope = typeParameterScope;
      alias.typeParameterScope = typeParameterScope;
      alias.typeParameterBindings = addTypeParameters(
        typeParameterScope,
        node.typeParameters,
      );
      activeScope = typeParameterScope;
    }

    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        continue;
      if (value && typeof value === "object") walk(value, activeScope, node);
    }
  }

  walk(ast, rootScope);
  const bindings = { nodeScopes, parents, rootScope };
  for (const scope of scopes) {
    for (const binding of scope.bindings.values()) {
      if (binding.kind !== "parameter" || !binding.typeAnnotation) continue;
      binding.database = ["database", "transaction"].includes(
        resolveDatabaseType(binding.typeAnnotation, scope, bindings),
      );
    }
  }
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
        const directCall = directCallForCallee(node, bindings.parents);
        const callback = unwrap(directCall?.arguments?.[0]);
        const isDirectInlineTransactionCall =
          directCall !== null &&
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

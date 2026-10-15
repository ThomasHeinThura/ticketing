#!/usr/bin/env node

/**
 * Structural ownership check for #580. This is deliberately a location/type gate, not a
 * proof that every repository predicate enforces the correct tenant reach. Query builders
 * and raw SQL fragments are detected by TypeScript-resolved symbols/types so local renames
 * and aliases do not create exemptions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { finish, repoRoot, violation, walk } from "./lib/repo.mjs";

const NAME = "check:queries";
const METHODS = new Set([
  "select",
  "selectDistinct",
  "selectDistinctOn",
  "insert",
  "update",
  "delete",
  "execute",
  "with",
  "$with",
  "$count",
  "refreshMaterializedView",
]);
const DRIZZLE_QUERY_TYPES =
  /^(?:Pg(?:Select|SelectBuilder|Insert|Update|Delete|Raw|RelationalQuery|RefreshMaterializedView)|QueryPromise|SQL|SQLWrapper)$/;
const DRIZZLE_DATABASE_TYPES =
  /^(?:PgDatabase|NodePgDatabase|PgTransaction|NodePgTransaction)$/;
const PG_TYPES = /^(?:Pool|PoolClient|Client|ClientBase)$/;
const HANDLE_NAME =
  /^(?:db|database|tx|trx|transaction|executor|dbOrTx|pool|client|connection)$/i;
const INFRA = new Set([
  "apps/api/src/database/schema.ts",
  "apps/api/src/database/relations.ts",
  "apps/api/src/database/index.ts",
  "apps/api/src/database/executor.ts",
  "apps/api/src/database/resolve-database-url.ts",
  "apps/api/src/database/wait-for-database.ts",
  "apps/api/src/database/prepare-database-startup.ts",
  "apps/api/src/database/migration-schema.ts",
  "apps/api/src/database/migrate-membership-provenance.ts",
  "apps/api/src/database/ensure-application-role.ts",
  "apps/api/src/database/assert-application-role-is-not-privileged.ts",
  "apps/api/src/database/assert-no-migration-url-in-api-process.ts",
  "apps/api/src/database/append-only-tables.ts",
  "apps/api/src/database/scram-sha-256.ts",
]);

export function isRepositoryPath(file) {
  return (
    INFRA.has(file) ||
    /(?:^|\/)(?:repository\.ts|[^/]+\.repository\.ts|repository\/.+)$/.test(
      file,
    )
  );
}

function symbolNames(type) {
  const names = [];
  for (const symbol of [type?.getSymbol?.(), type?.getAliasSymbol?.()]) {
    if (symbol?.name) names.push(symbol.name);
  }
  return names;
}

function hasNamedType(type, pattern, seen = new Set(), depth = 0) {
  if (!type || depth > 8 || seen.has(type.id)) return false;
  seen.add(type.id);
  if (symbolNames(type).some((name) => pattern.test(name))) return true;
  for (const part of type.getTypes?.() ?? []) {
    if (hasNamedType(part, pattern, seen, depth + 1)) return true;
  }
  try {
    for (const argument of type.getTypeArguments?.() ?? []) {
      if (hasNamedType(argument, pattern, seen, depth + 1)) return true;
    }
  } catch {
    // Not a type reference with arguments.
  }
  try {
    for (const base of type.getBaseTypes?.() ?? []) {
      if (hasNamedType(base, pattern, seen, depth + 1)) return true;
    }
  } catch {
    // getBaseTypes throws for non-class/interface types; the other type edges still apply.
  }
  const target = type.getTarget?.();
  return target && target.id !== type.id
    ? hasNamedType(target, pattern, seen, depth + 1)
    : false;
}

function isAnyOrError(type) {
  return !type || type.isErrorType?.() || (type.flags & 1) !== 0;
}

function diagnosticMessage(value) {
  const parts = [];
  const visit = (entry) => {
    if (typeof entry === "string") parts.push(entry);
    else if (entry && typeof entry === "object") {
      if (typeof entry.messageText === "string") parts.push(entry.messageText);
      else if (typeof entry.text === "string") parts.push(entry.text);
      for (const child of entry.next ?? []) visit(child);
    }
  };
  visit(value);
  return parts.join(" ") || "unavailable diagnostic message";
}

function importAlias(symbol) {
  return (symbol?.getDeclarations?.() ?? []).some(
    (declaration) =>
      declaration.kind === ts.SyntaxKind.ImportSpecifier ||
      declaration.kind === ts.SyntaxKind.NamespaceImport ||
      declaration.kind === ts.SyntaxKind.ImportClause ||
      declaration.kind === ts.SyntaxKind.ExportSpecifier,
  );
}

function identifierLike(node) {
  if (!node) return false;
  if (node.kind === ts.SyntaxKind.Identifier)
    return HANDLE_NAME.test(node.text);
  if (node.kind === ts.SyntaxKind.PropertyAccessExpression)
    return HANDLE_NAME.test(node.name.text);
  if (node.kind === ts.SyntaxKind.ElementAccessExpression) {
    const arg = node.argumentExpression;
    return (
      arg?.kind === ts.SyntaxKind.StringLiteral && HANDLE_NAME.test(arg.text)
    );
  }
  return false;
}

function callName(node) {
  let expr = node?.expression;
  while (
    expr?.kind === ts.SyntaxKind.ParenthesizedExpression ||
    expr?.kind === ts.SyntaxKind.NonNullExpression
  )
    expr = expr.expression;
  if (expr?.kind === ts.SyntaxKind.PropertyAccessExpression)
    return expr.name.text;
  if (
    expr?.kind === ts.SyntaxKind.ElementAccessExpression &&
    expr.argumentExpression?.kind === ts.SyntaxKind.StringLiteral
  )
    return expr.argumentExpression.text;
  if (expr?.kind === ts.SyntaxKind.Identifier) return expr.text;
  return "";
}

function isQueryBuilder(type, checker) {
  if (hasNamedType(type, DRIZZLE_QUERY_TYPES)) return true;
  try {
    const sig = checker.getSignaturesOfType(type, 0)[0];
    return sig
      ? hasNamedType(checker.getReturnTypeOfSignature(sig), DRIZZLE_QUERY_TYPES)
      : false;
  } catch {
    return false;
  }
}

function exportedQueryBoundary(
  type,
  checker,
  source,
  publicMembers,
  seen = new Set(),
  depth = 0,
) {
  if (!type) return { kind: "unresolved" };
  if (isQueryBuilder(type, checker)) return { kind: "builder" };
  if (depth >= 20 || seen.size >= 512) return { kind: "limit" };
  if (seen.has(type.id)) return { kind: "safe" };
  seen.add(type.id);

  if (
    isAnyOrError(type) ||
    ["any", "unknown", "<error>"].includes(checker.typeToString(type))
  )
    return { kind: "unresolved" };

  // Promise type arguments must be inspected before their awaited result: async function
  // return inference can otherwise reduce a returned builder to its assimilated row type.
  try {
    for (const argument of checker.getTypeArguments?.(type) ?? []) {
      const nested = exportedQueryBoundary(
        argument,
        checker,
        source,
        publicMembers,
        seen,
        depth + 1,
      );
      if (nested.kind !== "safe") return nested;
    }
  } catch {
    // Non-reference types do not have generic arguments.
  }
  const awaited = checker.getAwaitedType?.(type);
  if (awaited && awaited !== type) {
    const nested = exportedQueryBoundary(
      awaited,
      checker,
      source,
      publicMembers,
      seen,
      depth + 1,
    );
    if (nested.kind !== "safe") return nested;
  }

  for (const signature of checker.getSignaturesOfType(type, 0)) {
    const nested = exportedQueryBoundary(
      checker.getReturnTypeOfSignature(signature),
      checker,
      source,
      publicMembers,
      seen,
      depth + 1,
    );
    if (nested.kind !== "safe") return nested;
  }

  // Walk only declarations that form source-level public object/class APIs. This avoids
  // recursively inspecting every method on imported table/schema implementation types.
  for (const property of checker.getPropertiesOfType(type)) {
    const declarations =
      property.declarations ?? property.getDeclarations?.() ?? [];
    const publicApi = declarations.some((declaration) => {
      if (
        (declaration.path ?? declaration.getSourceFile?.().fileName) !==
        (source.path ?? source.fileName)
      )
        return false;
      if (!publicMembers.has(declaration.index)) return false;
      return [
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.MethodSignature,
        ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.GetAccessor,
      ].includes(declaration.kind);
    });
    if (!publicApi) continue;
    let propertyType;
    try {
      propertyType = checker.getTypeOfSymbolAtLocation(property, source);
    } catch {
      return { kind: "unresolved" };
    }
    const nested = exportedQueryBoundary(
      propertyType,
      checker,
      source,
      publicMembers,
      seen,
      depth + 1,
    );
    if (nested.kind !== "safe") return nested;
  }
  return { kind: "safe" };
}

function isSqlFactorySymbol(checker, node) {
  let type;
  try {
    type = checker.getTypeAtLocation(node);
  } catch {
    return false;
  }
  // A tag whose callable type returns Drizzle SQL is a raw SQL fragment constructor. This
  // catches aliased imports and local function aliases without relying on source spelling.
  return isQueryBuilder(type, checker);
}

function symbolComesFromPg(checker, node, seen = new Set(), depth = 0) {
  if (!node || depth > 8) return false;
  let symbol;
  try {
    symbol = checker.getSymbolAtLocation(node);
  } catch {
    return false;
  }
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  if (importAlias(symbol)) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return false;
    }
  }
  for (const declaration of symbol.getDeclarations?.() ?? []) {
    const file = declaration.getSourceFile().fileName;
    if (/(?:^|[/\\])@types[/\\]pg[/\\]/.test(file)) return true;
    if (
      declaration.kind === ts.SyntaxKind.VariableDeclaration &&
      declaration.initializer
    ) {
      let expression = declaration.initializer;
      while (
        expression.kind === ts.SyntaxKind.CallExpression &&
        expression.expression.kind === ts.SyntaxKind.PropertyAccessExpression &&
        ["bind", "call", "apply"].includes(expression.expression.name.text)
      )
        expression = expression.expression.expression;
      if (
        expression.kind === ts.SyntaxKind.PropertyAccessExpression &&
        ["query", "connect"].includes(expression.name.text)
      ) {
        try {
          if (
            hasNamedType(
              checker.getTypeAtLocation(expression.expression),
              PG_TYPES,
            )
          )
            return true;
        } catch {
          /* unresolved below */
        }
      }
      if (
        expression.kind === ts.SyntaxKind.ElementAccessExpression &&
        expression.argumentExpression?.kind === ts.SyntaxKind.StringLiteral &&
        ["query", "connect"].includes(expression.argumentExpression.text)
      ) {
        try {
          if (
            hasNamedType(
              checker.getTypeAtLocation(expression.expression),
              PG_TYPES,
            )
          )
            return true;
        } catch {
          /* unresolved below */
        }
      }
    }
    if (declaration.kind === ts.SyntaxKind.BindingElement) {
      const variable = declaration.parent?.parent;
      const initializer = variable?.initializer;
      if (initializer) {
        try {
          if (hasNamedType(checker.getTypeAtLocation(initializer), PG_TYPES))
            return true;
        } catch {
          /* unresolved below */
        }
      }
    }
  }
  return false;
}

function isPgQueryFunction(checker, node, source, seen = new Set()) {
  if (symbolComesFromPg(checker, node)) return true;
  let found = false;
  const name = node?.kind === ts.SyntaxKind.Identifier ? node.text : undefined;
  if (!name || seen.has(name)) return false;
  seen.add(name);
  function visit(current) {
    if (found) return;
    if (
      current.kind === ts.SyntaxKind.VariableDeclaration &&
      current.initializer
    ) {
      const binding = current.name;
      if (binding.kind === ts.SyntaxKind.Identifier && binding.text === name) {
        let init = current.initializer;
        while (
          init.kind === ts.SyntaxKind.CallExpression &&
          init.expression.kind === ts.SyntaxKind.PropertyAccessExpression &&
          ["bind", "call", "apply"].includes(init.expression.name.text)
        )
          init = init.expression.expression;
        if (
          init.kind === ts.SyntaxKind.PropertyAccessExpression &&
          ["query", "connect"].includes(init.name.text)
        ) {
          try {
            found = hasNamedType(
              checker.getTypeAtLocation(init.expression),
              PG_TYPES,
            );
          } catch {
            /* unresolved */
          }
        }
        if (
          !found &&
          init.kind === ts.SyntaxKind.ElementAccessExpression &&
          init.argumentExpression?.kind === ts.SyntaxKind.StringLiteral &&
          ["query", "connect"].includes(init.argumentExpression.text)
        ) {
          try {
            found = hasNamedType(
              checker.getTypeAtLocation(init.expression),
              PG_TYPES,
            );
          } catch {
            /* unresolved */
          }
        }
        if (!found && init.kind === ts.SyntaxKind.Identifier) {
          found = isPgQueryFunction(checker, init, source, seen);
        }
      }
      if (binding.kind === ts.SyntaxKind.ObjectBindingPattern) {
        for (const element of binding.elements) {
          const localName =
            element.name.kind === ts.SyntaxKind.Identifier
              ? element.name.text
              : "";
          const property = element.propertyName ?? element.name;
          const member =
            property.kind === ts.SyntaxKind.Identifier ||
            property.kind === ts.SyntaxKind.StringLiteral
              ? property.text
              : "";
          if (localName === name && ["query", "connect"].includes(member)) {
            try {
              found = hasNamedType(
                checker.getTypeAtLocation(current.initializer),
                PG_TYPES,
              );
            } catch {
              /* unresolved */
            }
          }
        }
      }
    }
    current.forEachChild(visit);
  }
  visit(source);
  return found;
}

function isQueryFunctionReference(checker, node, seen = new Set(), depth = 0) {
  if (!node || depth > 8) return false;
  if (
    node.kind === ts.SyntaxKind.ParenthesizedExpression ||
    node.kind === ts.SyntaxKind.NonNullExpression
  ) {
    return isQueryFunctionReference(checker, node.expression, seen, depth + 1);
  }
  if (
    node.kind === ts.SyntaxKind.PropertyAccessExpression ||
    node.kind === ts.SyntaxKind.ElementAccessExpression
  ) {
    const member =
      node.kind === ts.SyntaxKind.PropertyAccessExpression
        ? node.name.text
        : node.argumentExpression?.kind === ts.SyntaxKind.StringLiteral
          ? node.argumentExpression.text
          : "";
    let receiverType;
    try {
      receiverType = checker.getTypeAtLocation(node.expression);
    } catch {
      return false;
    }
    if (
      METHODS.has(member) &&
      hasNamedType(receiverType, DRIZZLE_DATABASE_TYPES)
    )
      return true;
    if (
      ["query", "connect"].includes(member) &&
      hasNamedType(receiverType, PG_TYPES)
    )
      return true;
    if (["bind", "call", "apply"].includes(member))
      return isQueryFunctionReference(
        checker,
        node.expression,
        seen,
        depth + 1,
      );
    return false;
  }
  if (node.kind !== ts.SyntaxKind.Identifier) return false;
  let symbol;
  try {
    symbol = checker.getSymbolAtLocation(node);
  } catch {
    return false;
  }
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  for (const declaration of symbol.getDeclarations?.() ?? []) {
    if (
      declaration.kind === ts.SyntaxKind.VariableDeclaration &&
      declaration.initializer
    ) {
      if (
        isQueryFunctionReference(
          checker,
          declaration.initializer,
          seen,
          depth + 1,
        )
      )
        return true;
    }
    if (declaration.kind === ts.SyntaxKind.BindingElement) {
      const variable = declaration.parent?.parent;
      const initializer = variable?.initializer;
      const property = declaration.propertyName ?? declaration.name;
      const member =
        property?.kind === ts.SyntaxKind.Identifier ||
        property?.kind === ts.SyntaxKind.StringLiteral
          ? property.text
          : "";
      if (initializer && METHODS.has(member)) {
        try {
          if (
            hasNamedType(
              checker.getTypeAtLocation(initializer),
              DRIZZLE_DATABASE_TYPES,
            )
          )
            return true;
        } catch {
          /* unresolved below */
        }
      }
      if (initializer && ["query", "connect"].includes(member)) {
        try {
          if (hasNamedType(checker.getTypeAtLocation(initializer), PG_TYPES))
            return true;
        } catch {
          /* unresolved below */
        }
      }
    }
  }
  let type;
  try {
    type = checker.getTypeAtLocation(node);
  } catch {
    return false;
  }
  return isQueryBuilder(type, checker) || symbolComesFromPg(checker, node);
}

/** Analyze already-parsed TypeScript source files using the project checker. */
export function analyzeQueryOwnership({
  files,
  snapshot,
  root = repoRoot,
  apiSourceRoot = path.join(root, "apps/api/src"),
}) {
  const violations = [];
  const add = (relative, line, message) =>
    violations.push(violation(relative, `line ${line}: ${message}`));
  for (const absolute of files) {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const sourceRelative = path
      .relative(apiSourceRoot, absolute)
      .split(path.sep)
      .join("/");
    if (sourceRelative.startsWith("../") || path.isAbsolute(sourceRelative))
      continue;
    const allowed = isRepositoryPath(sourceRelative);
    const project = snapshot.getDefaultProjectForFile(absolute);
    const source = project?.program.getSourceFile(absolute);
    if (!project || !source) {
      add(
        relative,
        1,
        "could not be parsed and typed by TypeScript; query ownership is unproven",
      );
      continue;
    }
    const syntactic = project.program.getSyntacticDiagnostics(absolute);
    if (syntactic.length) {
      for (const diagnostic of syntactic) {
        const start = diagnostic.start ?? diagnostic.pos;
        const line =
          diagnostic.file && start !== undefined
            ? diagnostic.file.getLineAndCharacterOfPosition(start).line + 1
            : 1;
        add(
          relative,
          line,
          `TypeScript parse error: ${diagnosticMessage(diagnostic.messageText)}`,
        );
      }
      continue;
    }
    const semantic = project.program.getSemanticDiagnostics(absolute);
    if (semantic.length) {
      for (const diagnostic of semantic) {
        const start = diagnostic.start ?? diagnostic.pos;
        const line =
          diagnostic.file && start !== undefined
            ? diagnostic.file.getLineAndCharacterOfPosition(start).line + 1
            : 1;
        add(
          relative,
          line,
          `TypeScript could not prove this file's types: ${diagnosticMessage(diagnostic.messageText)}`,
        );
      }
      continue;
    }
    const checker = project.checker;
    const reported = new Set();
    const reportNode = (node, message) => {
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const key = `${line}:${message}`;
      if (!reported.has(key)) {
        reported.add(key);
        add(relative, line, message);
      }
    };
    const checkCandidate = (node, receiver, operation) => {
      let receiverType;
      let resultType;
      try {
        receiverType = receiver && checker.getTypeAtLocation(receiver);
        resultType =
          node.kind === ts.SyntaxKind.CallExpression
            ? checker.getTypeAtLocation(node)
            : undefined;
      } catch {
        reportNode(
          node,
          `could not resolve ${operation} receiver type; query ownership is unproven`,
        );
        return;
      }
      const drizzle = hasNamedType(receiverType, DRIZZLE_DATABASE_TYPES);
      const pg = hasNamedType(receiverType, PG_TYPES);
      const resultBuilder = resultType && isQueryBuilder(resultType, checker);
      const knownSql =
        node.kind === ts.SyntaxKind.TaggedTemplateExpression &&
        isSqlFactorySymbol(checker, node.tag);
      const method = callName(node);
      const suspicious =
        METHODS.has(method) || method === "query" || method === "connect";
      const pgFunction =
        node.kind === ts.SyntaxKind.CallExpression &&
        isPgQueryFunction(checker, node.expression, source);
      const queryFunction =
        node.kind === ts.SyntaxKind.CallExpression &&
        isQueryFunctionReference(checker, node.expression);
      const unresolved =
        receiver !== undefined &&
        isAnyOrError(receiverType) &&
        (suspicious || identifierLike(receiver));
      const querySite =
        drizzle ||
        (pg && (method === "query" || method === "connect")) ||
        pgFunction ||
        queryFunction ||
        resultBuilder ||
        knownSql ||
        unresolved;
      if (!querySite) return;
      // db.transaction(callback) is permitted as orchestration. Its callback statements are
      // separately visited and must still be repository-owned.
      if (
        method === "transaction" &&
        drizzle &&
        node.kind === ts.SyntaxKind.CallExpression
      )
        return;
      if (!allowed) {
        reportNode(
          node,
          `${operation} is outside an allowed repository or explicit persistence-infrastructure file`,
        );
      }
      if (
        unresolved &&
        !drizzle &&
        !pg &&
        !pgFunction &&
        !queryFunction &&
        !resultBuilder &&
        !knownSql
      ) {
        reportNode(
          node,
          "unresolved query-like receiver; TypeScript could not prove its handle type",
        );
      }
    };

    function visit(node) {
      if (
        node.kind === ts.SyntaxKind.CallExpression ||
        node.kind === ts.SyntaxKind.TaggedTemplateExpression
      ) {
        const expr =
          node.kind === ts.SyntaxKind.CallExpression
            ? node.expression
            : node.tag;
        const name = callName({ expression: expr });
        let receiver;
        if (
          expr?.kind === ts.SyntaxKind.PropertyAccessExpression ||
          expr?.kind === ts.SyntaxKind.ElementAccessExpression
        )
          receiver = expr.expression;
        if (node.kind === ts.SyntaxKind.TaggedTemplateExpression) {
          checkCandidate(node, undefined, "raw SQL fragment construction");
        } else {
          // Calls on typed Drizzle handles, pg pools/clients, and query-builder objects.
          checkCandidate(
            node,
            receiver,
            `database operation ${name || "call"}`,
          );
          // Reflect.apply(fn, receiver, args), and Function.prototype call/apply/bind
          // preserve the query function's checker-resolved return type.
          const isReflectApply =
            expr?.kind === ts.SyntaxKind.PropertyAccessExpression &&
            expr.expression?.kind === ts.SyntaxKind.Identifier &&
            expr.expression.text === "Reflect" &&
            name === "apply";
          const isFunctionEscape =
            ["call", "apply", "bind"].includes(name) && receiver;
          if (isReflectApply || isFunctionEscape) {
            const target = isReflectApply ? node.arguments[0] : receiver;
            let targetType;
            try {
              targetType = target && checker.getTypeAtLocation(target);
            } catch {
              targetType = undefined;
            }
            const targetQuery =
              targetType && isQueryBuilder(targetType, checker);
            const targetOperation = isQueryFunctionReference(checker, target);
            const targetPg = symbolComesFromPg(checker, target);
            if ((targetQuery || targetOperation || targetPg) && !allowed)
              reportNode(
                node,
                "query function invoked through call/apply/bind outside an allowed repository",
              );
          }
        }
      }
      node.forEachChild(visit);
    }
    visit(source);

    // Public repository boundaries return rows/DTOs/scalars, never query builders.
    if (allowed) {
      const publicMembers = new Set();
      const memberKinds = new Set([
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.MethodSignature,
        ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.GetAccessor,
      ]);
      const collectPublicMembers = (node) => {
        if (memberKinds.has(node.kind)) {
          const modifiers = node.modifiers ?? [];
          if (
            !modifiers.some((modifier) =>
              [
                ts.SyntaxKind.PrivateKeyword,
                ts.SyntaxKind.ProtectedKeyword,
              ].includes(modifier.kind),
            )
          )
            publicMembers.add(node.index);
        }
        node.forEachChild?.(collectPublicMembers);
      };
      collectPublicMembers(source);
      const exports = [];
      const hasExport = (node) =>
        node.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );
      for (const statement of source.statements) {
        if (hasExport(statement)) {
          if (
            statement.kind === ts.SyntaxKind.FunctionDeclaration ||
            statement.kind === ts.SyntaxKind.ClassDeclaration ||
            statement.kind === ts.SyntaxKind.EnumDeclaration
          ) {
            if (statement.name)
              exports.push({ node: statement.name, boundary: statement });
          } else if (statement.kind === ts.SyntaxKind.VariableStatement) {
            for (const declaration of statement.declarationList.declarations)
              if (declaration.name.kind === ts.SyntaxKind.Identifier)
                exports.push({ node: declaration.name, boundary: declaration });
          }
        }
        if (statement.kind === ts.SyntaxKind.ExportAssignment)
          exports.push({ node: statement.expression, boundary: statement });
        if (statement.kind === ts.SyntaxKind.ExportDeclaration) {
          if (statement.isTypeOnly) continue;
          if (statement.exportClause?.kind === ts.SyntaxKind.NamedExports) {
            for (const specifier of statement.exportClause.elements)
              if (!specifier.isTypeOnly)
                exports.push({ node: specifier.name, boundary: specifier });
          } else if (!statement.exportClause) {
            // Star exports cannot be enumerated through the native AST's module symbol surface
            // with a reliable source location; fail closed rather than silently missing a value.
            reportNode(
              source,
              "export-star repository boundary cannot be enumerated; query-builder escape cannot be excluded",
            );
          }
        }
      }
      for (const exported of exports) {
        let type;
        try {
          type = checker.getTypeAtLocation(exported.node);
        } catch {
          reportNode(
            source,
            "could not type exported repository value; return shape is unproven",
          );
          continue;
        }
        const result = exportedQueryBoundary(
          type,
          checker,
          source,
          publicMembers,
        );
        if (result.kind === "builder")
          reportNode(
            exported.boundary,
            "exported repository value exposes a query builder instead of awaited rows, DTOs, or scalars",
          );
        else if (result.kind !== "safe")
          reportNode(
            exported.boundary,
            "exported repository value shape is unresolved or exceeds safe inspection limits; query-builder escape cannot be excluded",
          );
      }
    }
  }
  return violations;
}

export async function runQueryOwnershipCheck({ root = repoRoot } = {}) {
  const files = await walk(
    path.join(root, "apps/api/src"),
    (relative) =>
      /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(relative) &&
      !/\.d\.[cm]?ts$/.test(relative) &&
      !/(?:^|\/)(?:__tests__|tests?)(?:\/|$)/.test(relative) &&
      !/\.(?:test|spec)\.[^.]+$/.test(relative),
  );
  if (files.length === 0)
    return [
      violation(
        "apps/api/src",
        "no production API source files found; refusing vacuous success",
      ),
    ];
  const api = new API({ cwd: root });
  let snapshot;
  try {
    snapshot = api.updateSnapshot({
      openProjects: [path.join(root, "apps/api/tsconfig.json")],
      openFiles: files,
    });
    return analyzeQueryOwnership({ files, snapshot, root });
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await runQueryOwnershipCheck();
  finish({ name: NAME, failures: violations });
}

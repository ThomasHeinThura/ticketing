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
// Executable statements must never cross a repository boundary. SQL and SQLWrapper are
// separately classified below: D2 permits repository-owned fragments composed by another
// repository. Keep Aliased in the executable family because it is a selectable builder
// result rather than a predicate fragment.
const DRIZZLE_QUERY_TYPES =
  /^(?:Pg(?:Select|SelectBuilder|SelectBase|SelectQueryBuilderBase|Insert|InsertBase|Update|UpdateBase|Delete|DeleteBase|Raw|RelationalQuery|RefreshMaterializedView)|QueryPromise|Aliased)$/;
const DRIZZLE_SQL_FRAGMENT_TYPES = /^(?:SQL|SQLWrapper)$/;
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
    for (const argument of type.getAliasTypeArguments?.() ?? []) {
      if (hasNamedType(argument, pattern, seen, depth + 1)) return true;
    }
  } catch {
    // Some native API types have no alias arguments.
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

function isTypeScriptLibraryDeclaration(declaration) {
  const file = String(
    declaration.path ?? declaration.getSourceFile?.().fileName ?? "",
  ).replaceAll("\\", "/");
  return /(?:\/typescript\/lib|\/@typescript\/typescript-[^/]+\/lib)\/lib\.[^/]+\.d\.ts$/.test(
    file,
  );
}

function visibleMemberDeclaration(declaration) {
  let node = declaration;
  if (typeof declaration.resolve === "function") {
    try {
      node = declaration.resolve();
    } catch {
      return undefined;
    }
  }
  if (!node) return undefined;
  const modifiers = node.modifiers ?? [];
  return !modifiers.some((modifier) =>
    [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(
      modifier.kind,
    ),
  );
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

function hasSqlFragmentType(type, seen = new Set(), depth = 0) {
  if (!type || depth > 8 || seen.has(type.id)) return false;
  seen.add(type.id);
  if (symbolNames(type).some((name) => DRIZZLE_SQL_FRAGMENT_TYPES.test(name)))
    return true;
  // Union/intersection members and implemented base interfaces preserve the concrete
  // fragment identity. Do not follow generic arguments: Promise<SQL> is still a Promise
  // public shape that must be inspected recursively by exportedQueryBoundary.
  for (const part of type.getTypes?.() ?? []) {
    if (hasSqlFragmentType(part, seen, depth + 1)) return true;
  }
  try {
    for (const base of type.getBaseTypes?.() ?? []) {
      if (hasSqlFragmentType(base, seen, depth + 1)) return true;
    }
  } catch {
    // Non-class/interface types have no base types.
  }
  const target = type.getTarget?.();
  return target && target.id !== type.id
    ? hasSqlFragmentType(target, seen, depth + 1)
    : false;
}

function isSqlFragment(type) {
  return hasSqlFragmentType(type);
}

function isQueryOutput(type, checker) {
  if (isQueryBuilder(type, checker) || isSqlFragment(type)) return true;
  try {
    return checker
      .getSignaturesOfType(type, 0)
      .some((signature) =>
        isSqlFragment(checker.getReturnTypeOfSignature(signature)),
      );
  } catch {
    return false;
  }
}

function exportedQueryBoundary(
  type,
  checker,
  source,
  seen = new Set(),
  depth = 0,
) {
  if (!type) return { kind: "unresolved" };
  if (type.isTypeParameter?.()) {
    let constraint;
    try {
      constraint = checker.getConstraintOfTypeParameter(type);
    } catch {
      return { kind: "unresolved" };
    }
    if (!constraint) return { kind: "unresolved" };
    return isQueryBuilder(constraint, checker)
      ? { kind: "builder" }
      : { kind: "unresolved" };
  }
  // A query builder can also implement SQLWrapper. Check the executable families first so
  // a wrapper around a pending statement cannot be mistaken for a composable predicate.
  if (isQueryBuilder(type, checker)) return { kind: "builder" };
  if (isSqlFragment(type)) return { kind: "fragment" };
  if (depth >= 20 || seen.size >= 512) return { kind: "limit" };
  if (seen.has(type.id)) return { kind: "safe" };
  seen.add(type.id);

  if (
    isAnyOrError(type) ||
    ["any", "unknown", "<error>"].includes(checker.typeToString(type))
  )
    return { kind: "unresolved" };

  // Every constituent of a union or intersection is part of the public output graph.
  // In particular, T | undefined must not hide an unconstrained type parameter.
  const constituents = type.getTypes?.() ?? [];
  if (constituents.length) {
    for (const constituent of constituents) {
      const nested = exportedQueryBoundary(
        constituent,
        checker,
        source,
        seen,
        depth + 1,
      );
      if (nested.kind !== "safe" && nested.kind !== "fragment") return nested;
    }
  }

  // Promise type arguments must be inspected before their awaited result: async function
  // return inference can otherwise reduce a returned builder to its assimilated row type.
  try {
    for (const argument of checker.getTypeArguments?.(type) ?? []) {
      const nested = exportedQueryBoundary(
        argument,
        checker,
        source,
        seen,
        depth + 1,
      );
      if (nested.kind !== "safe" && nested.kind !== "fragment") return nested;
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
      seen,
      depth + 1,
    );
    if (nested.kind !== "safe" && nested.kind !== "fragment") return nested;
  }

  for (const signatureKind of [0, 1]) {
    for (const signature of checker.getSignaturesOfType(type, signatureKind)) {
      const nested = exportedQueryBoundary(
        checker.getReturnTypeOfSignature(signature),
        checker,
        source,
        seen,
        depth + 1,
      );
      if (nested.kind !== "safe" && nested.kind !== "fragment") return nested;
    }
  }

  // A visible imported interface is part of the same public output contract as a local
  // declaration. Follow every member type edge and exclude only members whose declarations
  // prove private/protected visibility. Known database/query implementation types are
  // classified above before their internals are traversed.
  for (const property of checker.getPropertiesOfType(type)) {
    const declarations = (
      property.declarations ??
      property.getDeclarations?.() ??
      []
    ).filter((declaration) => !isTypeScriptLibraryDeclaration(declaration));
    // Built-in prototype methods (Array/Function/Date, etc.) do not represent the
    // repository's returned data contract; their element/value types are followed through
    // type arguments and signatures above.
    if (!declarations.length) continue;
    const memberDeclarations = declarations.filter((declaration) =>
      [
        ts.SyntaxKind.MethodDeclaration,
        ts.SyntaxKind.MethodSignature,
        ts.SyntaxKind.PropertyAssignment,
        ts.SyntaxKind.PropertyDeclaration,
        ts.SyntaxKind.PropertySignature,
        ts.SyntaxKind.GetAccessor,
        ts.SyntaxKind.SetAccessor,
        ts.SyntaxKind.Parameter,
      ].includes(declaration.kind),
    );
    if (!memberDeclarations.length) {
      return { kind: "unresolved" };
    }
    const visibility = memberDeclarations.map(visibleMemberDeclaration);
    if (visibility.includes(undefined)) return { kind: "unresolved" };
    const publicDeclarations = memberDeclarations.filter(
      (_declaration, index) => visibility[index],
    );
    if (!publicDeclarations.length) continue;
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
      seen,
      depth + 1,
    );
    if (nested.kind !== "safe" && nested.kind !== "fragment") return nested;
  }
  for (const indexInfo of checker.getIndexInfosOfType(type)) {
    const nested = exportedQueryBoundary(
      indexInfo.valueType,
      checker,
      source,
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
  return isQueryOutput(type, checker);
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
  return isQueryOutput(type, checker) || symbolComesFromPg(checker, node);
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
    const sourceRelative = path.relative(apiSourceRoot, absolute);
    if (sourceRelative.startsWith("../") || path.isAbsolute(sourceRelative))
      continue;
    // `INFRA` and repository path patterns use repository-root-relative paths.
    const allowed = isRepositoryPath(relative);
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
      const resultBuilder = resultType && isQueryOutput(resultType, checker);
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
    // The exact infrastructure files are permitted to expose the low-level handles,
    // schema, and migration plumbing repositories consume. The public result-shape rule
    // applies to repository modules, not those explicit infrastructure modules.
    if (allowed && !INFRA.has(relative)) {
      // Use the compiler's runtime module surface as the invariant. Syntax-only export
      // enumeration misses anonymous defaults and namespace/star re-exports; AST is used
      // solely to distinguish explicitly type-only aliases, which have no runtime value.
      const typeOnlyExports = new Set();
      for (const statement of source.statements) {
        if (statement.kind !== ts.SyntaxKind.ExportDeclaration) continue;
        if (statement.isTypeOnly) {
          for (const specifier of statement.exportClause?.elements ?? [])
            typeOnlyExports.add(specifier.name.text);
        } else if (
          statement.exportClause?.kind === ts.SyntaxKind.NamedExports
        ) {
          for (const specifier of statement.exportClause.elements)
            if (specifier.isTypeOnly) typeOnlyExports.add(specifier.name.text);
        }
      }
      const moduleSymbol = checker.getSymbolAtLocation(source);
      if (!moduleSymbol) {
        reportNode(
          source,
          "could not resolve runtime module exports; query-builder escape cannot be excluded",
        );
      } else {
        const seenExports = new Set();
        let exportNodes = 0;
        const inspectExport = (exported, depth = 0) => {
          if (++exportNodes > 512 || depth > 20) {
            reportNode(
              source,
              "runtime export graph exceeds safe inspection limits; query-builder escape cannot be excluded",
            );
            return;
          }
          if (typeOnlyExports.has(exported.name)) return;
          let target = exported;
          const declarations = exported.declarations ?? [];
          const isAlias = declarations.some((declaration) =>
            [
              ts.SyntaxKind.ExportSpecifier,
              ts.SyntaxKind.NamespaceExport,
            ].includes(declaration.kind),
          );
          if (isAlias) {
            try {
              target = checker.getAliasedSymbol(exported);
            } catch {
              reportNode(
                source,
                "could not resolve runtime export alias; query-builder escape cannot be excluded",
              );
              return;
            }
          }
          if (!target) {
            reportNode(
              source,
              "runtime export has no resolvable symbol; query-builder escape cannot be excluded",
            );
            return;
          }
          const declarationsOfTarget = target.declarations ?? [];
          if (
            declarationsOfTarget.length > 0 &&
            declarationsOfTarget.every((declaration) =>
              [
                ts.SyntaxKind.InterfaceDeclaration,
                ts.SyntaxKind.TypeAliasDeclaration,
              ].includes(declaration.kind),
            )
          )
            return;

          const exportId = target.id ?? target.index ?? target.name;
          if (seenExports.has(exportId)) return;
          seenExports.add(exportId);

          // Namespace exports are runtime object boundaries. Recurse through the
          // compiler's actual exported members, including nested aliases.
          const namespaceExports =
            declarations.some(
              (declaration) =>
                declaration.kind === ts.SyntaxKind.NamespaceExport,
            ) || target.exports;
          if (namespaceExports) {
            let members;
            try {
              members = checker.getExportsOfModule(target);
            } catch {
              reportNode(
                source,
                "could not enumerate runtime namespace exports; query-builder escape cannot be excluded",
              );
              return;
            }
            for (const member of members) inspectExport(member, depth + 1);
            return;
          }

          let type;
          try {
            type = checker.getTypeOfSymbol(target);
          } catch {
            type = undefined;
          }
          if (!type) {
            reportNode(
              source,
              "could not type exported repository value; return shape is unproven",
            );
            return;
          }
          const result = exportedQueryBoundary(type, checker, source);
          if (result.kind === "builder")
            reportNode(
              source,
              "exported repository value exposes a query builder instead of awaited rows, DTOs, or scalars",
            );
          else if (result.kind !== "safe")
            reportNode(
              source,
              "exported repository value shape is unresolved or exceeds safe inspection limits; query-builder escape cannot be excluded",
            );
        };
        let runtimeExports;
        try {
          runtimeExports = checker.getExportsOfModule(moduleSymbol);
        } catch {
          reportNode(
            source,
            "could not enumerate runtime module exports; query-builder escape cannot be excluded",
          );
          runtimeExports = [];
        }
        for (const exported of runtimeExports) inspectExport(exported);
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

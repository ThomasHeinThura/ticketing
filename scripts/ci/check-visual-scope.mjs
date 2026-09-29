#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { repoRoot } from "./lib/repo.mjs";

const manifestPath = "apps/web/e2e/visual-screens.json";
const inventoryPath = "docs/02-design/screen-inventory.md";
const routeTreePath = "apps/web/src/routeTree.gen.ts";
const manifest = JSON.parse(
  await readFile(path.join(repoRoot, manifestPath), "utf8"),
);
const inventory = await readFile(path.join(repoRoot, inventoryPath), "utf8");
const routeTree = await readFile(path.join(repoRoot, routeTreePath), "utf8");
const failures = [];

function canonicalInventoryRoute(route) {
  const canonical = route.split("?")[0];
  return canonical
    .replace("/projects/{key}", "/projects/$projectKey")
    .replaceAll("{key}", "$key")
    .replaceAll("{id}", "$id")
    .replaceAll("{ref}", "$ref")
    .replaceAll("{typeKey}", "$typeKey");
}

function isNamedProperty(node, name) {
  return ts.isPropertyAccessExpression(node) && node.name.text === name;
}

function bindingContainsName(binding, name) {
  if (ts.isIdentifier(binding)) return binding.text === name;
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
    return binding.elements.some((element) =>
      ts.isOmittedExpression(element)
        ? false
        : bindingContainsName(element.name, name),
    );
  }
  return false;
}

function hasTrustedPlaywrightTestApi(sourceFile) {
  const trustedImports = new Set();
  let invalidImport = false;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !ts.isImportClause(statement.importClause) ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const clause = statement.importClause;
    for (const specifier of clause.namedBindings.elements) {
      if (!new Set(["test", "expect"]).has(specifier.name.text)) continue;
      const importedName = specifier.propertyName?.text ?? specifier.name.text;
      if (
        statement.moduleSpecifier.text === "@playwright/test" &&
        importedName === specifier.name.text &&
        !clause.isTypeOnly &&
        !specifier.isTypeOnly
      ) {
        trustedImports.add(specifier);
      } else {
        invalidImport = true;
      }
    }
  }

  let shadowedBinding = false;
  const visit = (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameterDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isCatchClause(node)) &&
      node.name &&
      ["test", "expect"].some((name) => bindingContainsName(node.name, name)) &&
      !(ts.isImportSpecifier(node) && trustedImports.has(node))
    ) {
      shadowedBinding = true;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return trustedImports.size === 2 && !invalidImport && !shadowedBinding;
}

const unsafeVisualRuntimeNames = new Set([
  "Array",
  "Bun",
  "Deno",
  "Function",
  "Reflect",
  "Symbol",
  "configure",
  "constructor",
  "eval",
  "fail",
  "fixme",
  "global",
  "globalThis",
  "module",
  "only",
  "process",
  "prototype",
  "require",
  "self",
  "skip",
  "window",
]);
const allowedVisualTestImports = new Map([
  ["test", false],
  ["expect", false],
  ["Page", true],
]);

/**
 * These two specs are the trust boundary for required screenshot execution. They only
 * need the Playwright test API, so fail closed on other imports, runtime loaders, test API
 * aliases/modifiers, process exits, or mutable intrinsic access. The checker separately
 * proves the allowed direct test declarations and screenshot statements below.
 */
function hasSafeVisualTestRuntime(sourceFile) {
  if (!sourceFile) return false;
  let unsafe = false;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "@playwright/test" ||
        !statement.importClause ||
        statement.importClause.isTypeOnly ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        unsafe = true;
        continue;
      }
      for (const specifier of statement.importClause.namedBindings.elements) {
        const importedName =
          specifier.propertyName?.text ?? specifier.name.text;
        const typeOnly =
          statement.importClause.isTypeOnly || specifier.isTypeOnly;
        if (
          importedName !== specifier.name.text ||
          !allowedVisualTestImports.has(importedName) ||
          allowedVisualTestImports.get(importedName) !== typeOnly
        ) {
          unsafe = true;
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
    ) {
      unsafe = true;
    }
  }

  const hasTestApiReference = (node) => {
    let found = false;
    const visit = (current) => {
      if (found) return;
      if (
        ts.isIdentifier(current) &&
        (current.text === "test" || current.text === "expect")
      ) {
        found = true;
        return;
      }
      current.forEachChild(visit);
    };
    visit(node);
    return found;
  };

  const visit = (node) => {
    if (unsafe) return;
    if (ts.isIdentifier(node) && unsafeVisualRuntimeNames.has(node.text)) {
      unsafe = true;
      return;
    }
    if (
      (ts.isParameterDeclaration(node) && node.initializer) ||
      (ts.isBindingElement(node) && node.initializer)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      hasTestApiReference(node.initializer)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      hasTestApiReference(node.right)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      unsafe = true;
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      const property = node.argumentExpression;
      if (hasTestApiReference(node.expression)) {
        unsafe = true;
        return;
      }
      if (
        property &&
        (ts.isStringLiteral(property) ||
          ts.isNoSubstitutionTemplateLiteral(property)) &&
        unsafeVisualRuntimeNames.has(property.text)
      ) {
        unsafe = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return !unsafe;
}

function testCallbacks(sourceFile, title) {
  if (!sourceFile || !hasTrustedPlaywrightTestApi(sourceFile)) return [];
  const callbacks = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "test" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title
    ) {
      callbacks.push(node.arguments[1]);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return callbacks;
}

function isPageRootedTarget(node) {
  if (ts.isIdentifier(node)) return node.text === "page";
  if (ts.isPropertyAccessExpression(node)) {
    return isPageRootedTarget(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    return isPageRootedTarget(node.expression);
  }
  return false;
}

function hasPlaywrightPageFixture(callback) {
  if (
    !ts.isArrowFunction(callback) ||
    !ts.isBlock(callback.body) ||
    !callback.parameters[0] ||
    !ts.isObjectBindingPattern(callback.parameters[0].name)
  ) {
    return false;
  }
  const fixture = callback.parameters[0].name.elements.some(
    (element) =>
      ts.isIdentifier(element.name) &&
      element.name.text === "page" &&
      (!element.propertyName ||
        (ts.isIdentifier(element.propertyName) &&
          element.propertyName.text === "page")),
  );
  if (!fixture) return false;

  let bypass = false;
  const visit = (node) => {
    if (bypass) return;
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameterDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isCatchClause(node)) &&
      node.name &&
      bindingContainsName(node.name, "page")
    ) {
      bypass = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isPageRootedTarget(node.left)
    ) {
      bypass = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isPageRootedTarget(node.operand)
    ) {
      bypass = true;
      return;
    }
    if (ts.isDeleteExpression(node) && isPageRootedTarget(node.expression)) {
      bypass = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(callback.body);
  return !bypass;
}

function propertyAccessPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    return [...propertyAccessPath(node.expression), node.name.text];
  }
  if (ts.isElementAccessExpression(node)) {
    const property = node.argumentExpression;
    return [
      ...propertyAccessPath(node.expression),
      ts.isStringLiteral(property) ||
      ts.isNoSubstitutionTemplateLiteral(property)
        ? property.text
        : "<computed>",
    ];
  }
  return [];
}

function isTestApiPath(parts) {
  return parts[0] === "test" || parts[0] === "it" || parts.includes("test");
}

function testDisableMethod(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const parts = propertyAccessPath(node.expression);
  if (!isTestApiPath(parts)) return undefined;
  if (parts.includes("<computed>")) return "dynamic test API method";

  const last = parts.at(-1);
  const previous = parts.at(-2);
  const disableMethod = parts.findLast((part) =>
    ["skip", "fixme", "fail", "only"].includes(part),
  );
  if (disableMethod && parts.includes("describe")) {
    return `describe.${disableMethod}`;
  }
  if (disableMethod && previous !== "configure") {
    return disableMethod;
  }
  if (previous === "describe" && last === "configure") {
    return "describe.configure";
  }
  return undefined;
}

function findTestDisable(node) {
  if (!node) return undefined;
  let method;
  const visit = (current) => {
    if (method) return;
    method = testDisableMethod(current);
    if (!method) current.forEachChild(visit);
  };
  visit(node);
  return method;
}

function findDisabledSuite(sourceFile) {
  if (!sourceFile) return undefined;
  let method;
  const visit = (node) => {
    if (method) return;
    const candidate = testDisableMethod(node);
    if (candidate?.startsWith("describe.")) {
      method = candidate;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return method;
}

function literalScreenshotOptionValue(node) {
  const value = unwrapTypeWrappers(node);
  if (
    ts.isStringLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    ts.isNumericLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (!ts.isObjectLiteralExpression(value)) return false;
  return value.properties.every(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      literalScreenshotOptionValue(property.initializer),
  );
}

function screenshotOptionsHaveFullPage(node, sourceFile) {
  let options = unwrapTypeWrappers(node);
  if (ts.isIdentifier(options)) {
    const declarations = [];
    const visit = (current) => {
      if (!current) return;
      if (
        ts.isVariableDeclaration(current) &&
        ts.isIdentifier(current.name) &&
        current.name.text === options.text
      ) {
        declarations.push(current);
      }
      current.forEachChild(visit);
    };
    visit(sourceFile);
    if (
      declarations.length !== 1 ||
      !declarations[0].initializer ||
      !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return false;
    }
    options = unwrapTypeWrappers(declarations[0].initializer);
  }
  if (
    !ts.isObjectLiteralExpression(options) ||
    !literalScreenshotOptionValue(options)
  ) {
    return false;
  }
  const fullPageProperties = options.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "fullPage") ||
        (ts.isStringLiteral(property.name) &&
          property.name.text === "fullPage")),
  );
  return (
    fullPageProperties.length === 1 &&
    fullPageProperties[0].initializer.kind === ts.SyntaxKind.TrueKeyword
  );
}

function isExpectingPage(node) {
  if (!ts.isCallExpression(node)) return false;
  const isExpect =
    (ts.isIdentifier(node.expression) && node.expression.text === "expect") ||
    (ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "expect" &&
      node.expression.name.text === "soft");
  return (
    isExpect &&
    node.arguments.length >= 1 &&
    ts.isIdentifier(node.arguments[0]) &&
    node.arguments[0].text === "page" &&
    node.arguments.slice(1).every(isSafeExpectationMessage)
  );
}

function isSafeExpectationMessage(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return true;
  }
  if (!ts.isTemplateExpression(node) || node.templateSpans.length !== 1) {
    return false;
  }
  const [span] = node.templateSpans;
  return (
    ts.isPropertyAccessExpression(span.expression) &&
    span.expression.name.text === "id" &&
    ts.isIdentifier(span.expression.expression) &&
    span.expression.expression.text === "story"
  );
}

function awaitedScreenshotName(statement, sourceFile) {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isAwaitExpression(statement.expression) ||
    !ts.isCallExpression(statement.expression.expression) ||
    !isNamedProperty(
      statement.expression.expression.expression,
      "toHaveScreenshot",
    )
  ) {
    return undefined;
  }
  const screenshot = statement.expression.expression;
  const [name, options] = screenshot.arguments;
  if (
    screenshot.arguments.length !== 2 ||
    !ts.isStringLiteral(name) ||
    !isExpectingPage(screenshot.expression.expression) ||
    !options ||
    !screenshotOptionsHaveFullPage(options, sourceFile)
  ) {
    return undefined;
  }
  return {
    name: name.text,
    start: statement.getStart(),
    end: statement.expression.expression.end,
  };
}

function isPageNavigationCall(node) {
  return (
    ts.isCallExpression(node) &&
    isNamedProperty(node.expression, "goto") &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "page"
  );
}

function isScreenshotCall(node) {
  return (
    ts.isCallExpression(node) &&
    isNamedProperty(node.expression, "toHaveScreenshot")
  );
}

function isRouteInterceptCall(node) {
  return (
    ts.isCallExpression(node) &&
    (isNamedProperty(node.expression, "route") ||
      isNamedProperty(node.expression, "routeFromHAR"))
  );
}

function isSafeLocatorArgument(node) {
  const value = unwrapTypeWrappers(node);
  if (literalScreenshotOptionValue(value)) return true;
  return false;
}

function isPageLocator(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "page" &&
    [
      "getByLabel",
      "getByPlaceholder",
      "getByRole",
      "getByTestId",
      "getByText",
      "locator",
    ].includes(node.expression.name.text) &&
    node.arguments.length > 0 &&
    node.arguments.every(isSafeLocatorArgument)
  );
}

function isVisibleAssertionStatement(statement) {
  if (
    ts.isExpressionStatement(statement) &&
    ts.isAwaitExpression(statement.expression) &&
    ts.isCallExpression(statement.expression.expression) &&
    isNamedProperty(statement.expression.expression.expression, "toBeVisible")
  ) {
    const assertion = statement.expression.expression;
    const expectation = assertion.expression.expression;
    return (
      assertion.arguments.length === 0 &&
      isExpectCallForSafeLocator(expectation)
    );
  }
  return false;
}

function isExpectCallForSafeLocator(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "expect" &&
    node.arguments.length === 1 &&
    isPageLocator(node.arguments[0])
  );
}

function isApiRouteSetupStatement(statement) {
  if (
    !(
      ts.isExpressionStatement(statement) &&
      ts.isAwaitExpression(statement.expression) &&
      ts.isCallExpression(statement.expression.expression) &&
      isNamedProperty(statement.expression.expression.expression, "route") &&
      ts.isIdentifier(statement.expression.expression.expression.expression) &&
      statement.expression.expression.expression.expression.text === "page" &&
      ts.isStringLiteral(statement.expression.expression.arguments[0]) &&
      statement.expression.expression.arguments[0].text === "**/api/**"
    )
  )
    return false;

  const [, handler] = statement.expression.expression.arguments;
  return hasSafeApiRouteHandler(handler);
}

function hasSafeApiRouteHandler(handler) {
  if (!ts.isArrowFunction(handler) || !ts.isBlock(handler.body)) return false;
  const [routeParameter] = handler.parameters;
  if (!routeParameter || !ts.isIdentifier(routeParameter.name)) return false;
  const routeName = routeParameter.name.text;
  const forbiddenBrowserNames = new Set([
    "document",
    "window",
    "globalThis",
    "self",
    "page",
  ]);
  const forbiddenBrowserOperations = new Set([
    "addInitScript",
    "evaluate",
    "goto",
    "innerHTML",
    "outerHTML",
    "reload",
    "setContent",
    "write",
  ]);
  let safe = true;
  const visit = (node) => {
    if (!safe) return;
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      if (node !== handler) {
        safe = false;
        return;
      }
    }
    // API route fixtures may shape JSON with property access and calls from the
    // allowlist below. Computed access and tagged templates are outside that
    // grammar: either can invoke a browser fixture captured from the enclosing
    // Playwright test without spelling `page.setContent` in ordinary AST nodes.
    if (
      ts.isElementAccessExpression(node) ||
      ts.isTaggedTemplateExpression(node)
    ) {
      safe = false;
      return;
    }
    const isPropertyName =
      (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
      (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);
    if (
      (ts.isIdentifier(node) &&
        forbiddenBrowserNames.has(node.text) &&
        !isPropertyName) ||
      (ts.isPropertyAccessExpression(node) &&
        forbiddenBrowserOperations.has(node.name.text))
    ) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const allowed =
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "JSON" &&
          expression.name.text === "stringify") ||
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.name.text === "endsWith") ||
        (ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === routeName &&
          ["request", "fulfill"].includes(expression.name.text)) ||
        (ts.isPropertyAccessExpression(expression) &&
          expression.name.text === "url" &&
          ts.isCallExpression(expression.expression) &&
          ts.isPropertyAccessExpression(expression.expression.expression) &&
          ts.isIdentifier(expression.expression.expression.expression) &&
          expression.expression.expression.expression.text === routeName &&
          expression.expression.expression.name.text === "request");
      if (!allowed) {
        safe = false;
        return;
      }
    }
    if (ts.isNewExpression(node)) {
      if (!ts.isIdentifier(node.expression) || node.expression.text !== "URL") {
        safe = false;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(handler.body);
  return safe;
}

function isAuthenticatedFixtureSetupStatement(statement) {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isAwaitExpression(statement.expression) &&
    ts.isCallExpression(statement.expression.expression) &&
    ts.isIdentifier(statement.expression.expression.expression) &&
    statement.expression.expression.expression.text ===
      "installAuthenticatedFixture" &&
    statement.expression.expression.arguments.length === 1 &&
    ts.isIdentifier(statement.expression.expression.arguments[0]) &&
    statement.expression.expression.arguments[0].text === "page"
  );
}

function hasSafeAuthenticatedFixtureHelper(sourceFile) {
  if (!sourceFile) return false;
  const helpers = sourceFile.statements.filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "installAuthenticatedFixture",
  );
  if (helpers.length !== 1) return false;
  const body = helpers[0].body;
  return (
    body !== undefined &&
    body.statements.length === 1 &&
    isApiRouteSetupStatement(body.statements[0])
  );
}

function hasShadowedFixtureHelper(callback) {
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return true;
  const allowedNames = new Set(
    callback.body.statements
      .filter(isAuthenticatedFixtureSetupStatement)
      .map((statement) => statement.expression.expression.expression),
  );
  let shadowed = false;
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "installAuthenticatedFixture" &&
      !allowedNames.has(node)
    ) {
      shadowed = true;
    }
    node.forEachChild(visit);
  };
  visit(callback);
  return shadowed;
}

function testVisualEvidence(callback, sourceFile) {
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
    return {
      screenshots: [],
      directScreenshots: [],
      navigations: [],
      directNavigations: [],
      returns: [],
    };
  }

  const screenshots = [];
  const navigations = [];
  const returns = [];
  const visit = (node) => {
    if (isScreenshotCall(node)) screenshots.push(node);
    if (isPageNavigationCall(node)) navigations.push(node);
    if (ts.isReturnStatement(node)) returns.push(node);
    node.forEachChild((child) => {
      // A return from a nested fixture/request callback does not exit the
      // Playwright test. Only returns in the test's own control-flow scope can
      // make its route screenshot unreachable.
      if (
        ts.isArrowFunction(child) ||
        ts.isFunctionExpression(child) ||
        ts.isFunctionDeclaration(child)
      ) {
        if (child === callback) visit(child);
        return;
      }
      visit(child);
    });
  };
  visit(callback.body);

  const directScreenshots = callback.body.statements
    .map((statement) => ({
      statement,
      evidence: awaitedScreenshotName(statement, sourceFile),
    }))
    .filter(({ evidence }) => evidence !== undefined)
    .map(({ statement, evidence }) => ({
      ...evidence,
      statementIndex: callback.body.statements.indexOf(statement),
      statementStart: statement.getStart(),
      statementEnd: statement.end,
    }));
  const directNavigations = callback.body.statements
    .filter(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isAwaitExpression(statement.expression) &&
        isPageNavigationCall(statement.expression.expression),
    )
    .map((statement) => {
      const call = statement.expression.expression;
      const [url] = call.arguments;
      return {
        url: ts.isStringLiteral(url) ? url.text : undefined,
        statementIndex: callback.body.statements.indexOf(statement),
        statementStart: statement.getStart(),
        statementEnd: statement.end,
        start: statement.getStart(),
        end: statement.end,
      };
    });

  return {
    screenshots,
    directScreenshots,
    navigations,
    directNavigations,
    returns,
  };
}

function navigationMatchesApplicationRoute(
  navigation,
  applicationRoute,
  inventoryRoute,
) {
  // Visual route tests use a concrete path through Playwright's configured base
  // URL. Require that the path itself is the app route; an alias or redirect
  // must be declared explicitly in the manifest instead of silently standing in
  // for the screen being measured.
  if (!navigation.startsWith("/") || navigation.startsWith("//")) {
    return false;
  }

  const actualUrl = new URL(navigation, "http://visual.invalid");
  const expectedUrl = new URL(
    inventoryRoute ?? applicationRoute,
    "http://visual.invalid",
  );
  const actualPath = actualUrl.pathname;
  const expectedPath = applicationRoute;
  if (
    actualUrl.search !== expectedUrl.search ||
    actualUrl.hash !== expectedUrl.hash
  ) {
    return false;
  }
  const actualSegments = actualPath.split("/").filter(Boolean);
  const expectedSegments = expectedPath.split("/").filter(Boolean);
  if (actualSegments.length !== expectedSegments.length) {
    return false;
  }

  return expectedSegments.every((segment, index) => {
    if (segment.startsWith("$")) {
      return actualSegments[index].length > 0;
    }
    return actualSegments[index] === segment;
  });
}

function unwrapTypeWrappers(node) {
  let expression = node;
  while (
    ts.isAsExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isFetchedIndexDeclaration(declaration, responseName) {
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "index" ||
    !declaration.initializer
  ) {
    return false;
  }
  const initializer = unwrapTypeWrappers(declaration.initializer);
  return (
    ts.isAwaitExpression(initializer) &&
    ts.isCallExpression(initializer.expression) &&
    isNamedProperty(initializer.expression.expression, "json") &&
    ts.isIdentifier(initializer.expression.expression.expression) &&
    initializer.expression.expression.expression.text === responseName
  );
}

function isObjectFreezeStatement(statement, target) {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression) ||
    !isNamedProperty(statement.expression.expression, "freeze") ||
    !ts.isIdentifier(statement.expression.expression.expression) ||
    statement.expression.expression.expression.text !== "Object" ||
    statement.expression.arguments.length !== 1
  ) {
    return false;
  }
  const [argument] = statement.expression.arguments;
  if (target === "index") {
    return ts.isIdentifier(argument) && argument.text === "index";
  }
  return (
    ts.isPropertyAccessExpression(argument) &&
    argument.name.text === "entries" &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === "index"
  );
}

function isFrozenIndexEntryValuesStatement(statement) {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression) ||
    !isNamedProperty(statement.expression.expression, "forEach") ||
    statement.expression.arguments.length !== 1
  ) {
    return false;
  }
  const values = statement.expression.expression.expression;
  const callback = statement.expression.arguments[0];
  const callbackExpression =
    ts.isArrowFunction(callback) && ts.isBlock(callback.body)
      ? callback.body.statements.length === 1 &&
        ts.isExpressionStatement(callback.body.statements[0])
        ? callback.body.statements[0].expression
        : undefined
      : ts.isArrowFunction(callback)
        ? callback.body
        : undefined;
  if (
    !ts.isCallExpression(values) ||
    !isNamedProperty(values.expression, "values") ||
    !ts.isIdentifier(values.expression.expression) ||
    values.expression.expression.text !== "Object" ||
    values.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(values.arguments[0]) ||
    values.arguments[0].name.text !== "entries" ||
    !ts.isIdentifier(values.arguments[0].expression) ||
    values.arguments[0].expression.text !== "index" ||
    !ts.isArrowFunction(callback) ||
    callback.parameters.length !== 1 ||
    !callback.parameters[0] ||
    !ts.isIdentifier(callback.parameters[0].name) ||
    !callbackExpression ||
    !ts.isCallExpression(callbackExpression) ||
    !isNamedProperty(callbackExpression.expression, "freeze") ||
    !ts.isIdentifier(callbackExpression.expression.expression) ||
    callbackExpression.expression.expression.text !== "Object" ||
    callbackExpression.arguments.length !== 1 ||
    !ts.isIdentifier(callbackExpression.arguments[0]) ||
    callbackExpression.arguments[0].text !== callback.parameters[0].name.text
  ) {
    return false;
  }
  return true;
}

function hasFrozenStorybookIndex(callback) {
  if (!ts.isBlock(callback.body)) return false;
  const statements = callback.body.statements;
  const indexStatementIndex = statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        isFetchedIndexDeclaration(declaration, "response"),
      ),
  );
  if (indexStatementIndex < 0) return false;

  const indexStatement = statements[indexStatementIndex];
  const indexDeclaration = indexStatement.declarationList.declarations.find(
    (declaration) => isFetchedIndexDeclaration(declaration, "response"),
  );
  if (!indexDeclaration || !ts.isIdentifier(indexDeclaration.name)) {
    return false;
  }
  const [freezeEntries, freezeEntryValues, freezeIndex, storiesStatement] =
    statements.slice(indexStatementIndex + 1, indexStatementIndex + 5);
  return (
    isObjectFreezeStatement(freezeEntries, "entries") &&
    isFrozenIndexEntryValuesStatement(freezeEntryValues) &&
    isObjectFreezeStatement(freezeIndex, "index") &&
    ts.isVariableStatement(storiesStatement) &&
    storiesStatement.declarationList.declarations.some(isStoriesDeclaration)
  );
}

function isStoriesDeclaration(declaration) {
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "stories" ||
    !declaration.initializer ||
    !ts.isCallExpression(declaration.initializer) ||
    !ts.isPropertyAccessExpression(declaration.initializer.expression) ||
    declaration.initializer.expression.name.text !== "freeze" ||
    !ts.isIdentifier(declaration.initializer.expression.expression) ||
    declaration.initializer.expression.expression.text !== "Object" ||
    declaration.initializer.arguments.length !== 1 ||
    !ts.isCallExpression(declaration.initializer.arguments[0]) ||
    !isNamedProperty(declaration.initializer.arguments[0].expression, "map")
  ) {
    return false;
  }

  const mapCall = declaration.initializer.arguments[0];
  const mapCallback = mapCall.arguments[0];
  if (
    !ts.isArrowFunction(mapCallback) ||
    mapCallback.parameters.length !== 1 ||
    !mapCallback.parameters[0] ||
    !ts.isIdentifier(mapCallback.parameters[0].name) ||
    !ts.isCallExpression(mapCallback.body) ||
    !ts.isPropertyAccessExpression(mapCallback.body.expression) ||
    mapCallback.body.expression.name.text !== "freeze" ||
    !ts.isIdentifier(mapCallback.body.expression.expression) ||
    mapCallback.body.expression.expression.text !== "Object" ||
    mapCallback.body.arguments.length !== 1 ||
    !ts.isIdentifier(mapCallback.body.arguments[0]) ||
    mapCallback.body.arguments[0].text !== mapCallback.parameters[0].name.text
  ) {
    return false;
  }

  const sortCall = mapCall.expression.expression;
  if (
    !ts.isCallExpression(sortCall) ||
    !isNamedProperty(sortCall.expression, "sort")
  ) {
    return false;
  }
  const filterCall = sortCall.expression.expression;
  if (
    !ts.isCallExpression(filterCall) ||
    !isNamedProperty(filterCall.expression, "filter")
  ) {
    return false;
  }

  const valuesCall = filterCall.expression.expression;
  if (
    !ts.isCallExpression(valuesCall) ||
    !isNamedProperty(valuesCall.expression, "values") ||
    !ts.isIdentifier(valuesCall.expression.expression) ||
    valuesCall.expression.expression.text !== "Object"
  ) {
    return false;
  }

  const entries = valuesCall.arguments[0];
  const indexEntries =
    ts.isPropertyAccessExpression(entries) &&
    entries.name.text === "entries" &&
    ts.isIdentifier(entries.expression) &&
    entries.expression.text === "index";
  const predicate = filterCall.arguments[0];
  const storyTypeFilter =
    ts.isArrowFunction(predicate) &&
    ts.isBinaryExpression(predicate.body) &&
    predicate.body.operatorToken.kind ===
      ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isPropertyAccessExpression(predicate.body.left) &&
    predicate.body.left.name.text === "type" &&
    ts.isIdentifier(predicate.body.left.expression) &&
    predicate.body.left.expression.text === "entry" &&
    ts.isStringLiteral(predicate.body.right) &&
    predicate.body.right.text === "story";

  return indexEntries && storyTypeFilter;
}

function hasStoryArrayMutation(callback) {
  const mutatingMethods = new Set([
    "copyWithin",
    "fill",
    "pop",
    "push",
    "reverse",
    "shift",
    "sort",
    "splice",
    "unshift",
  ]);
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      mutatingMethods.has(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "stories"
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      !bindingContainsName(node.name, "Object") &&
      (isObjectIntrinsicRoot(node.initializer) ||
        (ts.isIdentifier(node.initializer) &&
          node.initializer.text === "globalThis"))
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ((ts.isIdentifier(node.left) && node.left.text === "stories") ||
        (ts.isPropertyAccessExpression(node.left) &&
          ts.isIdentifier(node.left.expression) &&
          node.left.expression.text === "stories") ||
        (ts.isElementAccessExpression(node.left) &&
          ts.isIdentifier(node.left.expression) &&
          node.left.expression.text === "stories"))
    ) {
      unsafe = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ((ts.isIdentifier(node.operand) && node.operand.text === "stories") ||
        (ts.isPropertyAccessExpression(node.operand) &&
          ts.isIdentifier(node.operand.expression) &&
          node.operand.expression.text === "stories") ||
        (ts.isElementAccessExpression(node.operand) &&
          ts.isIdentifier(node.operand.expression) &&
          node.operand.expression.text === "stories"))
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isDeleteExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "stories") ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "stories"))
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(callback.body);
  return unsafe;
}

function isObjectIntrinsicRoot(node) {
  if (!node) return false;
  const parts = propertyAccessPath(node);
  return (
    parts[0] === "Object" ||
    (parts[0] === "globalThis" && parts[1] === "Object")
  );
}

function hasObjectIntrinsicMutation(sourceFile) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isIdentifier(node) &&
      ["Reflect", "global", "globalThis", "self", "window"].includes(node.text)
    ) {
      unsafe = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === "Object") {
      const access = node.parent;
      const call = access?.parent;
      if (
        !ts.isPropertyAccessExpression(access) ||
        access.expression !== node ||
        !ts.isCallExpression(call) ||
        call.expression !== access ||
        !["freeze", "values"].includes(access.name.text)
      ) {
        unsafe = true;
        return;
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      !bindingContainsName(node.name, "Object") &&
      (isObjectIntrinsicRoot(node.initializer) ||
        (ts.isIdentifier(node.initializer) &&
          node.initializer.text === "globalThis"))
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isObjectIntrinsicRoot(node.left)
    ) {
      unsafe = true;
      return;
    }
    if (ts.isDeleteExpression(node) && isObjectIntrinsicRoot(node.expression)) {
      unsafe = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isObjectIntrinsicRoot(node.operand)
    ) {
      unsafe = true;
      return;
    }
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameterDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node)) &&
      node.name &&
      bindingContainsName(node.name, "Object")
    ) {
      unsafe = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const path = propertyAccessPath(node.expression);
      const method = path.at(-1);
      const writesObject =
        (path[0] === "Object" &&
          [
            "assign",
            "defineProperty",
            "defineProperties",
            "setPrototypeOf",
          ].includes(method) &&
          node.arguments.some(isObjectIntrinsicRoot)) ||
        (path[0] === "Reflect" &&
          ["set", "defineProperty"].includes(method) &&
          isObjectIntrinsicRoot(node.arguments[0]));
      if (writesObject) {
        unsafe = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return unsafe;
}

/** Dynamic source execution can change the loop's iterator after static inspection. */
function hasDynamicCodeExecution(sourceFile) {
  let unsafe = false;
  const dynamicExecutors = new Set(["eval", "Function"]);
  const visit = (node) => {
    if (ts.isIdentifier(node) && dynamicExecutors.has(node.text)) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return unsafe;
}

function isNonemptyStoriesAssertion(statement) {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression) ||
    !isNamedProperty(statement.expression.expression, "toBeGreaterThan") ||
    !ts.isNumericLiteral(statement.expression.arguments[0]) ||
    statement.expression.arguments[0].text !== "0"
  ) {
    return false;
  }
  const expectCall = statement.expression.expression.expression;
  return (
    ts.isCallExpression(expectCall) &&
    ts.isIdentifier(expectCall.expression) &&
    expectCall.expression.text === "expect" &&
    ts.isPropertyAccessExpression(expectCall.arguments[0]) &&
    expectCall.arguments[0].name.text === "length" &&
    ts.isIdentifier(expectCall.arguments[0].expression) &&
    expectCall.arguments[0].expression.text === "stories"
  );
}

function isStoryScreenshotTemplate(node) {
  if (
    !ts.isTemplateExpression(node) ||
    node.head.text !== "" ||
    node.templateSpans.length !== 1
  ) {
    return false;
  }
  const [span] = node.templateSpans;
  return (
    ts.isPropertyAccessExpression(span.expression) &&
    span.expression.name.text === "id" &&
    ts.isIdentifier(span.expression.expression) &&
    span.expression.expression.text === "story" &&
    span.literal.text === ".png"
  );
}

function isStoryNavigation(statement) {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isAwaitExpression(statement.expression) ||
    !ts.isCallExpression(statement.expression.expression) ||
    !isNamedProperty(statement.expression.expression.expression, "goto") ||
    !ts.isIdentifier(statement.expression.expression.expression.expression) ||
    statement.expression.expression.expression.expression.text !== "page"
  ) {
    return false;
  }
  const [url] = statement.expression.expression.arguments;
  return (
    ts.isTemplateExpression(url) &&
    url.head.text.includes("/iframe.html?id=") &&
    url.templateSpans.some(
      (span) =>
        ts.isPropertyAccessExpression(span.expression) &&
        span.expression.name.text === "id" &&
        ts.isIdentifier(span.expression.expression) &&
        span.expression.expression.text === "story",
    )
  );
}

function isPageScreenshotCall(node, sourceFile) {
  if (
    !ts.isCallExpression(node) ||
    !isNamedProperty(node.expression, "toHaveScreenshot") ||
    !isExpectingPage(node.expression.expression)
  ) {
    return false;
  }
  const [name, options] = node.arguments;
  return (
    node.arguments.length === 2 &&
    (ts.isStringLiteral(name) || ts.isTemplateExpression(name)) &&
    options !== undefined &&
    screenshotOptionsHaveFullPage(options, sourceFile)
  );
}

function hasStoryLoopControlBypass(loop) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return;
    }
    if (
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isContinueStatement(node) ||
      ts.isBreakStatement(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(loop.statement);
  return unsafe;
}

function hasStoryCoverageControlBypass(callback) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return;
    }
    if (
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isContinueStatement(node) ||
      ts.isBreakStatement(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node)
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(callback.body);
  return unsafe;
}

function hasStoryScreenshotLoop(callback, sourceFile) {
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return false;
  const loops = callback.body.statements.filter((statement) =>
    ts.isForOfStatement(statement),
  );
  if (loops.length !== 1) return false;

  const [loop] = loops;
  const declaration =
    ts.isVariableDeclarationList(loop.initializer) &&
    loop.initializer.declarations.length === 1
      ? loop.initializer.declarations[0]
      : undefined;
  if (
    !declaration ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "story" ||
    !ts.isIdentifier(loop.expression) ||
    loop.expression.text !== "stories" ||
    !ts.isBlock(loop.statement)
  ) {
    return false;
  }
  if (hasStoryLoopControlBypass(loop)) return false;

  const navigationStatements =
    loop.statement.statements.filter(isStoryNavigation);
  const screenshotStatements = loop.statement.statements.filter((statement) => {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isAwaitExpression(statement.expression) ||
      !isPageScreenshotCall(statement.expression.expression, sourceFile)
    ) {
      return false;
    }
    return isStoryScreenshotTemplate(
      statement.expression.expression.arguments[0],
    );
  });
  return (
    navigationStatements.length === 1 &&
    screenshotStatements.length === 1 &&
    loop.statement.statements.at(-1) === screenshotStatements[0]
  );
}

function hasStorybookCoverage(sourceFile, title) {
  const callbacks = testCallbacks(sourceFile, title);
  if (callbacks.length !== 1) return false;
  const [callback] = callbacks;
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) return false;

  const statements = callback.body.statements;
  const declarations = statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations
      : [],
  );
  const responseDeclaration = declarations.find((declaration) => {
    if (
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !declaration.initializer ||
      !ts.isAwaitExpression(declaration.initializer) ||
      !ts.isCallExpression(declaration.initializer.expression) ||
      !ts.isIdentifier(declaration.initializer.expression.expression) ||
      declaration.initializer.expression.expression.text !== "fetch"
    ) {
      return false;
    }
    const [url] = declaration.initializer.expression.arguments;
    return (
      ts.isStringLiteral(url) && url.text === "http://127.0.0.1:6006/index.json"
    );
  });
  const fetchesStoryIndex =
    responseDeclaration &&
    ts.isVariableDeclaration(responseDeclaration) &&
    ts.isIdentifier(responseDeclaration.name) &&
    declarations.some((declaration) =>
      isFetchedIndexDeclaration(declaration, responseDeclaration.name.text),
    );
  const derivesStoriesFromEveryExport = statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(isStoriesDeclaration),
  );

  return (
    hasPlaywrightPageFixture(callback) &&
    fetchesStoryIndex &&
    hasFrozenStorybookIndex(callback) &&
    derivesStoriesFromEveryExport &&
    !hasObjectIntrinsicMutation(sourceFile) &&
    !hasDynamicCodeExecution(sourceFile) &&
    statements.some(isNonemptyStoriesAssertion) &&
    !hasStoryCoverageControlBypass(callback) &&
    !hasStoryArrayMutation(callback) &&
    hasStoryScreenshotLoop(callback, sourceFile)
  );
}

const inventoryRows = [
  ...inventory.matchAll(
    /^\| ([^|]+) \| `([^`]+)` \| route \| [^|]+ \| ([^|]+) \|/gm,
  ),
].map(([, name, route, status]) => ({
  name: name.trim(),
  route,
  status: status.trim(),
}));
const inventoryRoutes = new Set(inventoryRows.map(({ route }) => route));
const activeInventoryRows = inventoryRows.filter(({ status }) =>
  /[🟡✅]/u.test(status),
);
const appRoutes = new Set(
  [...routeTree.matchAll(/fullPath: '([^']+)'/g)].map(([, route]) => route),
);
const registeredInventoryRouteGroups = new Map();
for (const row of inventoryRows) {
  const canonicalRoute = canonicalInventoryRoute(row.route);
  if (!appRoutes.has(canonicalRoute)) continue;
  const group = registeredInventoryRouteGroups.get(canonicalRoute) ?? [];
  group.push(row);
  registeredInventoryRouteGroups.set(canonicalRoute, group);
}
const seenTests = new Set();
const seenInventoryRoutes = new Set();
const visualSpecPath = path.join(repoRoot, "apps/web/e2e/visual.spec.ts");
const storySpecPath = path.join(
  repoRoot,
  "apps/web/e2e/storybook-visual.spec.ts",
);
const parser = new API({ cwd: repoRoot });
let visualSourceFile;
let storySourceFile;
try {
  const snapshot = parser.updateSnapshot({
    openFiles: [visualSpecPath, storySpecPath],
  });
  try {
    const visualProject = snapshot.getDefaultProjectForFile(visualSpecPath);
    const storyProject = snapshot.getDefaultProjectForFile(storySpecPath);
    visualSourceFile = visualProject?.program.getSourceFile(visualSpecPath);
    storySourceFile = storyProject?.program.getSourceFile(storySpecPath);
    if (
      !visualSourceFile ||
      visualProject.program.getSyntacticDiagnostics(visualSpecPath).length > 0
    ) {
      failures.push(
        `${visualSpecPath} could not be parsed for visual-test evidence`,
      );
    }
    if (
      !storySourceFile ||
      storyProject.program.getSyntacticDiagnostics(storySpecPath).length > 0
    ) {
      failures.push(
        `${storySpecPath} could not be parsed for Storybook coverage`,
      );
    }
    if (visualSourceFile && !hasTrustedPlaywrightTestApi(visualSourceFile)) {
      failures.push(
        `${path.basename(visualSpecPath)} must bind test and expect directly to @playwright/test without shadow declarations`,
      );
    }
    if (storySourceFile && !hasTrustedPlaywrightTestApi(storySourceFile)) {
      failures.push(
        `${path.basename(storySpecPath)} must bind test and expect directly to @playwright/test without shadow declarations`,
      );
    }
    if (visualSourceFile && !hasSafeVisualTestRuntime(visualSourceFile)) {
      failures.push(
        `${path.basename(visualSpecPath)} contains imports or runtime constructs that can alias or disable Playwright tests, mutate primordials, or exit before screenshots run`,
      );
    }
    if (storySourceFile && !hasSafeVisualTestRuntime(storySourceFile)) {
      failures.push(
        `${path.basename(storySpecPath)} contains imports or runtime constructs that can alias or disable Playwright tests, mutate primordials, or exit before screenshots run`,
      );
    }
  } finally {
    snapshot.dispose();
  }
} finally {
  parser.close();
}

const visualFileDisable = findTestDisable(visualSourceFile);
if (visualFileDisable && !visualFileDisable.startsWith("describe.")) {
  failures.push(
    `${path.basename(visualSpecPath)} cannot contain test.skip, test.fixme, test.fail, or test.only calls`,
  );
}
if (findDisabledSuite(visualSourceFile)) {
  failures.push(
    `${path.basename(visualSpecPath)} cannot disable or reconfigure Playwright suites`,
  );
}

let mappedPageNavigations = 0;
let mappedScreenshotAssertions = 0;
for (const screen of manifest) {
  if (seenTests.has(screen.test))
    failures.push(`duplicate test name: ${screen.test}`);
  seenTests.add(screen.test);
  if (!screen.test.endsWith("@visual")) {
    failures.push(`${screen.name} test is not tagged @visual`);
  }
  const matchingCallbacks = visualSourceFile
    ? testCallbacks(visualSourceFile, screen.test)
    : [];
  const matchingEvidence = matchingCallbacks.map((callback) =>
    testVisualEvidence(callback, visualSourceFile),
  );
  if (
    matchingCallbacks.length === 1 &&
    !hasPlaywrightPageFixture(matchingCallbacks[0])
  ) {
    failures.push(
      `${screen.name} visual test must receive the Playwright page fixture directly without shadowing or mutation`,
    );
  }
  if (matchingCallbacks.some(findTestDisable)) {
    failures.push(`${screen.name} visual test cannot be skipped or fixme`);
  }
  if (matchingCallbacks.length === 0) {
    failures.push(
      `${screen.name} has no matching test in apps/web/e2e/visual.spec.ts`,
    );
  } else if (matchingCallbacks.length > 1) {
    failures.push(
      `${screen.name} has duplicate tests named ${JSON.stringify(screen.test)} in apps/web/e2e/visual.spec.ts`,
    );
  } else if (
    matchingEvidence[0].directScreenshots.length !== 1 ||
    matchingEvidence[0].directScreenshots[0]?.name !== screen.screenshot ||
    matchingEvidence[0].screenshots.length !== 1 ||
    matchingEvidence[0].directScreenshots[0].end !==
      matchingEvidence[0].screenshots[0].end
  ) {
    failures.push(
      `${screen.name} test does not capture its declared screenshot baseline directly and exactly once`,
    );
  }
  if (matchingEvidence.length === 1) {
    const evidence = matchingEvidence[0];
    mappedPageNavigations += evidence.navigations.length;
    mappedScreenshotAssertions += evidence.screenshots.length;
    if (
      evidence.navigations.length !== 1 ||
      evidence.directNavigations.length !== 1 ||
      evidence.directNavigations[0]?.url === undefined ||
      !navigationMatchesApplicationRoute(
        evidence.directNavigations[0]?.url ?? "",
        screen.applicationRoute,
        screen.inventoryRoute,
      )
    ) {
      failures.push(
        `${screen.name} visual test must have exactly one direct awaited literal navigation to its declared application route ${screen.inventoryRoute ?? screen.applicationRoute}`,
      );
    }
    if (
      evidence.directNavigations.length === 1 &&
      evidence.directScreenshots.length === 1 &&
      evidence.directScreenshots[0].start < evidence.directNavigations[0].end
    ) {
      failures.push(
        `${screen.name} visual test captures its screenshot before navigating to its declared route`,
      );
    }
    if (evidence.returns.length > 0) {
      failures.push(
        `${screen.name} visual test can return before its route screenshot assertion`,
      );
    }
    if (
      evidence.directNavigations.length === 1 &&
      evidence.directScreenshots.length === 1
    ) {
      const callbackBody = matchingCallbacks[0].body;
      const navigationIndex = evidence.directNavigations[0].statementIndex;
      const screenshotIndex = evidence.directScreenshots[0].statementIndex;
      const postNavigation = callbackBody.statements.slice(
        navigationIndex + 1,
        screenshotIndex,
      );
      const preNavigation = callbackBody.statements.slice(0, navigationIndex);
      if (
        screenshotIndex !== callbackBody.statements.length - 1 ||
        postNavigation.some(
          (statement) => !isVisibleAssertionStatement(statement),
        ) ||
        !postNavigation.some(isVisibleAssertionStatement) ||
        preNavigation.some(
          (statement) =>
            !isApiRouteSetupStatement(statement) &&
            !isAuthenticatedFixtureSetupStatement(statement),
        ) ||
        !hasSafeAuthenticatedFixtureHelper(visualSourceFile) ||
        hasShadowedFixtureHelper(matchingCallbacks[0])
      ) {
        failures.push(
          `${screen.name} visual test must use only API fixture setup before navigation, assert visible route content afterward, and finish with its declared screenshot assertion`,
        );
      }
    }
  }
  if (!screen.screenshot.endsWith(".png")) {
    failures.push(`${screen.name} must name a PNG screenshot baseline`);
  }
  if (screen.inventoryRoute) {
    if (!inventoryRoutes.has(screen.inventoryRoute)) {
      failures.push(
        `${screen.name} does not reference an exact route row in ${inventoryPath}`,
      );
    }
    if (
      !activeInventoryRows.some(({ route }) => route === screen.inventoryRoute)
    ) {
      failures.push(
        `${screen.name} is not an in-progress or complete route row in ${inventoryPath}`,
      );
    }
    const canonical = canonicalInventoryRoute(screen.inventoryRoute);
    if (canonical !== screen.applicationRoute) {
      failures.push(
        `${screen.name} application route does not match its inventory canonical route`,
      );
    }
    if (seenInventoryRoutes.has(screen.inventoryRoute)) {
      failures.push(`duplicate inventory route row: ${screen.inventoryRoute}`);
    }
    seenInventoryRoutes.add(screen.inventoryRoute);
    if (!registeredInventoryRouteGroups.has(screen.applicationRoute)) {
      failures.push(
        `${screen.name} maps to no currently implemented inventory route`,
      );
    }
  } else {
    if (!screen.reason)
      failures.push(
        `${screen.name} has no inventory route and no documented reason`,
      );
    if (
      inventoryRows.some(
        ({ route }) =>
          canonicalInventoryRoute(route) === screen.applicationRoute,
      )
    ) {
      failures.push(
        `${screen.name} is inventory-backed and must name its exact inventoryRoute`,
      );
    }
  }
  if (!appRoutes.has(screen.applicationRoute)) {
    failures.push(`${screen.name} route is missing from ${routeTreePath}`);
  }
  const baseline = path.join(
    repoRoot,
    "apps/web/e2e/visual.spec.ts-snapshots",
    `${screen.screenshot.replace(/\.png$/, "")}-linux.png`,
  );
  try {
    await access(baseline);
  } catch {
    failures.push(
      `${screen.name} has no committed Playwright baseline at ${path.relative(repoRoot, baseline)}`,
    );
  }
}

let visualFilePageNavigations = 0;
let visualFileScreenshotAssertions = 0;
let visualFileInvalidRouteInterceptions = 0;
const countVisualFileNavigations = (node) => {
  if (isPageNavigationCall(node)) visualFilePageNavigations += 1;
  if (isScreenshotCall(node)) visualFileScreenshotAssertions += 1;
  if (isRouteInterceptCall(node)) {
    const [matcher] = node.arguments;
    if (!ts.isStringLiteral(matcher) || matcher.text !== "**/api/**") {
      visualFileInvalidRouteInterceptions += 1;
    }
  }
  node.forEachChild(countVisualFileNavigations);
};
if (visualSourceFile) countVisualFileNavigations(visualSourceFile);
if (
  visualFilePageNavigations !== mappedPageNavigations ||
  visualFileScreenshotAssertions !== mappedScreenshotAssertions ||
  visualFileInvalidRouteInterceptions > 0
) {
  failures.push(
    `${path.basename(visualSpecPath)} contains page navigation or screenshot assertions outside its named visual tests, or intercepts a non-API document route`,
  );
}

for (const { name, route } of activeInventoryRows) {
  const applicationRoute = canonicalInventoryRoute(route);
  if (!appRoutes.has(applicationRoute)) {
    failures.push(
      `in-progress or complete inventory route ${name} (${route}) is missing from ${routeTreePath}`,
    );
  }
  if (!seenInventoryRoutes.has(route)) {
    failures.push(
      `in-progress or complete inventory route ${name} (${route}) has no G8 test/baseline manifest entry`,
    );
  }
}

for (const [applicationRoute, rows] of registeredInventoryRouteGroups) {
  if (!rows.some(({ status }) => /[🟡✅]/u.test(status))) {
    failures.push(
      `registered inventory route ${applicationRoute} has no row marked in progress or complete`,
    );
  }
}

const storyTitle =
  "every exported Storybook story has a visual baseline @visual";
const storyCallbacks = storySourceFile
  ? testCallbacks(storySourceFile, storyTitle)
  : [];
if (storyCallbacks.some(findTestDisable)) {
  failures.push("Storybook visual test cannot be skipped or fixme");
}
const storyFileDisable = findTestDisable(storySourceFile);
if (storyFileDisable && !storyFileDisable.startsWith("describe.")) {
  failures.push(
    `${path.basename(storySpecPath)} cannot contain test.skip, test.fixme, test.fail, or test.only calls`,
  );
}
if (findDisabledSuite(storySourceFile)) {
  failures.push(
    `${path.basename(storySpecPath)} cannot disable or reconfigure Playwright suites`,
  );
}
if (!storySourceFile || !hasStorybookCoverage(storySourceFile, storyTitle)) {
  failures.push(
    "Storybook visual test must load the exported-story index, enumerate every story, reject an empty set, and await its per-story screenshot baseline",
  );
}

if (failures.length) {
  console.error(
    `G8 scope check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `G8 scope check passed: ${manifest.length} screenshot cases, ${seenInventoryRoutes.size} active inventory route rows mapped (${activeInventoryRows.length} in-progress or complete among ${inventoryRows.length} route rows). Storybook story coverage is checked at runtime.`,
  );
}

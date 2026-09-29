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

function testCallbacks(sourceFile, title) {
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

function propertyAccessPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (!ts.isPropertyAccessExpression(node)) return [];
  return [...propertyAccessPath(node.expression), node.name.text];
}

function isTestApiPath(parts) {
  return parts[0] === "test" || parts[0] === "it" || parts.includes("test");
}

function testDisableMethod(node) {
  if (!ts.isCallExpression(node)) return undefined;
  const parts = propertyAccessPath(node.expression);
  if (!isTestApiPath(parts)) return undefined;

  const last = parts.at(-1);
  const previous = parts.at(-2);
  if ((last === "skip" || last === "fixme") && previous !== "describe") {
    return last;
  }
  if (previous === "describe" && (last === "skip" || last === "fixme")) {
    return `describe.${last}`;
  }
  if (previous === "describe" && last === "configure") {
    const mode = node.arguments
      .filter(ts.isObjectLiteralExpression)
      .flatMap((argument) => argument.properties)
      .find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === "mode") ||
            (ts.isStringLiteral(property.name) &&
              property.name.text === "mode")),
      );
    if (!mode) return undefined;
    if (
      ts.isStringLiteral(mode.initializer) &&
      ["default", "parallel", "serial"].includes(mode.initializer.text)
    ) {
      return undefined;
    }
    return "describe.configure({ mode: 'skip' or dynamic })";
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

function awaitedScreenshotName(statement) {
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
  const [name] = statement.expression.expression.arguments;
  if (!ts.isStringLiteral(name)) return undefined;
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

function testVisualEvidence(callback) {
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
    return {
      screenshots: [],
      directScreenshots: [],
      navigations: [],
      directNavigations: [],
    };
  }

  const screenshots = [];
  const navigations = [];
  const visit = (node) => {
    if (isScreenshotCall(node)) screenshots.push(node);
    if (isPageNavigationCall(node)) navigations.push(node);
    node.forEachChild(visit);
  };
  visit(callback.body);

  const directScreenshots = callback.body.statements
    .map((statement) => ({
      statement,
      evidence: awaitedScreenshotName(statement),
    }))
    .filter(({ evidence }) => evidence !== undefined)
    .map(({ evidence }) => evidence);
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
        start: statement.getStart(),
        end: statement.end,
      };
    });

  return { screenshots, directScreenshots, navigations, directNavigations };
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

function isStoriesDeclaration(declaration) {
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== "stories" ||
    !declaration.initializer ||
    !ts.isCallExpression(declaration.initializer) ||
    !isNamedProperty(declaration.initializer.expression, "sort")
  ) {
    return false;
  }

  const filterCall = declaration.initializer.expression.expression;
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

function hasStoryScreenshotLoop(callback) {
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

  const navigatesToEachStory =
    loop.statement.statements.some(isStoryNavigation);
  const capturesEachStory = loop.statement.statements.some((statement) => {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isAwaitExpression(statement.expression) ||
      !ts.isCallExpression(statement.expression.expression) ||
      !isNamedProperty(
        statement.expression.expression.expression,
        "toHaveScreenshot",
      )
    ) {
      return false;
    }
    return isStoryScreenshotTemplate(
      statement.expression.expression.arguments[0],
    );
  });
  return navigatesToEachStory && capturesEachStory;
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
    fetchesStoryIndex &&
    derivesStoriesFromEveryExport &&
    statements.some(isNonemptyStoriesAssertion) &&
    hasStoryScreenshotLoop(callback)
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
  } finally {
    snapshot.dispose();
  }
} finally {
  parser.close();
}

const visualFileDisable = findTestDisable(visualSourceFile);
if (visualFileDisable && !visualFileDisable.startsWith("describe.")) {
  failures.push(
    `${path.basename(visualSpecPath)} cannot contain test.skip or test.fixme calls`,
  );
}
if (findDisabledSuite(visualSourceFile)) {
  failures.push(
    `${path.basename(visualSpecPath)} cannot disable tests with test.describe.skip/fixme or test.describe.configure({ mode: 'skip' })`,
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
  const matchingEvidence = matchingCallbacks.map(testVisualEvidence);
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
const countVisualFileNavigations = (node) => {
  if (isPageNavigationCall(node)) visualFilePageNavigations += 1;
  if (isScreenshotCall(node)) visualFileScreenshotAssertions += 1;
  node.forEachChild(countVisualFileNavigations);
};
if (visualSourceFile) countVisualFileNavigations(visualSourceFile);
if (
  visualFilePageNavigations !== mappedPageNavigations ||
  visualFileScreenshotAssertions !== mappedScreenshotAssertions
) {
  failures.push(
    `${path.basename(visualSpecPath)} contains page navigation or screenshot assertions outside its named visual tests`,
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
    `${path.basename(storySpecPath)} cannot contain test.skip or test.fixme calls`,
  );
}
if (findDisabledSuite(storySourceFile)) {
  failures.push(
    `${path.basename(storySpecPath)} cannot disable tests with test.describe.skip/fixme or test.describe.configure({ mode: 'skip' })`,
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

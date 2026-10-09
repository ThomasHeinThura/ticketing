#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { repoRoot } from "./lib/repo.mjs";

const manifestPath = "apps/web/e2e/visual-screens.json";
const inventoryPath = "docs/02-design/screen-inventory.md";
const routeTreePaths = [
  "apps/web/src/routeTree.agent.gen.ts",
  "apps/web/src/routeTree.portal.gen.ts",
];
const rootPackagePath = "package.json";
const webPackagePath = "apps/web/package.json";
const baseConfigPath = "apps/web/playwright.config.ts";
const visualConfigPath = "apps/web/playwright.visual.config.ts";
const storybookConfigPath = "apps/web/playwright.storybook.config.ts";
const storybookMainPath = "packages/ui/.storybook/main.ts";
const ciWorkflowPath = ".github/workflows/ci-full.yml";
const manifest = JSON.parse(
  await readFile(path.join(repoRoot, manifestPath), "utf8"),
);
const inventory = await readFile(path.join(repoRoot, inventoryPath), "utf8");
const routeTrees = await Promise.all(
  routeTreePaths.map((routeTreePath) =>
    readFile(path.join(repoRoot, routeTreePath), "utf8"),
  ),
);
const routeTreeLabel = routeTreePaths.join(" and ");
const rootPackage = JSON.parse(
  await readFile(path.join(repoRoot, rootPackagePath), "utf8"),
);
const webPackage = JSON.parse(
  await readFile(path.join(repoRoot, webPackagePath), "utf8"),
);
const ciWorkflow = await readFile(path.join(repoRoot, ciWorkflowPath), "utf8");
const storybookMain = await readFile(
  path.join(repoRoot, storybookMainPath),
  "utf8",
);
const failures = [];

const expectedRootVisualCommand =
  "pnpm check:visual-scope && pnpm --filter @taskdesk/web test:visual";
const expectedWebVisualCommand =
  "pnpm build && playwright test --config playwright.visual.config.ts --grep @visual && playwright test --config playwright.storybook.config.ts --grep @visual";
const expectedVisualStepName =
  "Check inventory scope and run screen and Storybook baselines";
const expectedStorybookMain = [
  'import type { StorybookConfig } from "@storybook/react-vite";',
  'import tailwindcss from "@tailwindcss/vite";',
  "",
  "const config: StorybookConfig = {",
  '  stories: ["../src/**/*.stories.@(ts|tsx)"],',
  '  framework: "@storybook/react-vite",',
  "  addons: [],",
  "  viteFinal: async (viteConfig) => ({",
  "    ...viteConfig,",
  "    plugins: [...(viteConfig.plugins ?? []), tailwindcss()],",
  "  }),",
  "};",
  "",
  "export default config;",
  "",
].join("\n");

if (rootPackage.scripts?.["test:visual"] !== expectedRootVisualCommand) {
  failures.push(
    `${rootPackagePath} test:visual must run check:visual-scope and @taskdesk/web test:visual`,
  );
}
if (webPackage.scripts?.["test:visual"] !== expectedWebVisualCommand) {
  failures.push(
    `${webPackagePath} test:visual must run route and Storybook Playwright configs with @visual`,
  );
}
if (webPackage.scripts?.dev !== "vite") {
  failures.push(`${webPackagePath} dev must launch Vite for route screenshots`);
}
if (storybookMain !== expectedStorybookMain) {
  failures.push(
    `${storybookMainPath} must retain the full TypeScript story glob and trusted Storybook configuration`,
  );
}
const workflowLines = ciWorkflow.split(/\r?\n/u);
const expectedWorkflowRootKeys = [
  "name",
  "on",
  "permissions",
  "concurrency",
  "env",
  "jobs",
];
const actualWorkflowRootKeys = workflowLines
  .filter(
    (line) => line !== "" && !line.startsWith(" ") && !line.startsWith("#"),
  )
  .map((line) => /^([A-Za-z][A-Za-z0-9_-]*)\s*:/u.exec(line)?.[1]);
const rootEnvStart = workflowLines.indexOf("env:");
let rootEnvEnd = workflowLines.findIndex(
  (line, index) =>
    index > rootEnvStart &&
    line !== "" &&
    !line.startsWith(" ") &&
    !line.startsWith("#"),
);
if (rootEnvEnd === -1) rootEnvEnd = workflowLines.length;
const actualRootEnvLines = workflowLines
  .slice(rootEnvStart, rootEnvEnd)
  .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
const expectedRootEnvLines = [
  "env:",
  '  TURBO_TELEMETRY_DISABLED: "1"',
  '  DO_NOT_TRACK: "1"',
];
const visualJobStarts = workflowLines
  .map((line, index) => (line === "  visual:" ? index : -1))
  .filter((index) => index >= 0);
const visualJobStart = visualJobStarts[0] ?? -1;
let visualJobEnd = workflowLines.findIndex(
  (line, index) => index > visualJobStart && /^ {2}[A-Za-z0-9_-]+:/u.test(line),
);
if (visualJobEnd === -1) visualJobEnd = workflowLines.length;
const visualJob =
  visualJobStart === -1
    ? ""
    : workflowLines.slice(visualJobStart, visualJobEnd).join("\n");
const visualJobLines = visualJob.split("\n");
const expectedVisualJobLines = [
  "  visual:",
  "    name: visual regression (G8)",
  // The one permitted condition: run unless the merge base's classifier proved the pull
  // request policy-only (ci-cd.md § Applicability; workflow-gates.mjs A9).
  "    needs: scope",
  "    if: ${{ !cancelled() && needs.scope.outputs.full != 'false' }}",
  "    runs-on: ubuntu-latest",
  "    container:",
  "      image: mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27",
  "      options: --ipc=host",
  "    timeout-minutes: 20",
  "    steps:",
  "      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0",
  "      - name: Trust the checked-out repository inside the Playwright container",
  '        run: git config --global --add safe.directory "$GITHUB_WORKSPACE"',
  "      - uses: ./.github/actions/setup",
  "      - name: Build the permissions package used by the web bundle",
  "        run: pnpm --filter @taskdesk/permissions build",
  "      - name: Normalize Ubuntu APT mirror for Chromium dependencies",
  "        run: node scripts/ci/normalize-ubuntu-apt-mirror.mjs",
  "      - name: Install Chromium",
  "        run: apps/web/node_modules/.bin/playwright install --with-deps chromium",
  `      - name: ${expectedVisualStepName}`,
  "        run: pnpm test:visual",
  "      - name: Upload visual diffs",
  "        if: always()",
  "        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
  "        with:",
  "          name: playwright-visual",
  "          path: apps/web/test-results/",
  "          if-no-files-found: warn",
  "          retention-days: 7",
];
const actualVisualJobLines = visualJobLines.filter(
  (line) => line.trim() !== "" && !line.trimStart().startsWith("#"),
);
const visualStepStarts = visualJobLines
  .map((line, index) =>
    line === `      - name: ${expectedVisualStepName}` ? index : -1,
  )
  .filter((index) => index >= 0);
const visualStepStart = visualStepStarts[0] ?? -1;
let visualStepEnd = visualJobLines.findIndex(
  (line, index) => index > visualStepStart && /^ {6}- /u.test(line),
);
if (visualStepEnd === -1) visualStepEnd = visualJobLines.length;
const visualStep =
  visualStepStart === -1
    ? []
    : visualJobLines.slice(visualStepStart, visualStepEnd);

function hasOnlyMappingKeys(lines, indentation, expectedKeys) {
  const seen = new Set();
  for (const line of lines) {
    const spaces = /^ */u.exec(line)?.[0].length ?? 0;
    if (spaces !== indentation) continue;
    const key = line.slice(indentation);
    if (key === "" || key.startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:/u.exec(key);
    if (!match || !expectedKeys.includes(match[1]) || seen.has(match[1])) {
      return false;
    }
    seen.add(match[1]);
  }
  return seen.size === expectedKeys.length;
}

if (
  actualWorkflowRootKeys.join("\n") !== expectedWorkflowRootKeys.join("\n") ||
  actualRootEnvLines.join("\n") !== expectedRootEnvLines.join("\n") ||
  visualJobStarts.length !== 1 ||
  actualVisualJobLines.join("\n") !== expectedVisualJobLines.join("\n") ||
  !/^ {4}name: visual regression \(G8\)\s*$/mu.test(visualJob) ||
  visualStepStarts.length !== 1 ||
  visualStep.filter((line) => line === "        run: pnpm test:visual")
    .length !== 1 ||
  !hasOnlyMappingKeys(visualJobLines, 4, [
    "name",
    "needs",
    "if",
    "runs-on",
    "container",
    "timeout-minutes",
    "steps",
  ]) ||
  workflowLines.some((line) =>
    /^(?:defaults|"defaults"|'defaults')\s*:/u.test(line),
  ) ||
  !hasOnlyMappingKeys(visualStep, 8, ["run"])
) {
  failures.push(
    `${ciWorkflowPath} must run pnpm test:visual exactly once in one failure-propagating visual regression (G8) job and step, conditioned only by the canonical change-scope gate`,
  );
}

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

function configObject(sourceFile) {
  if (!sourceFile) return undefined;
  const assignment = sourceFile.statements.find(ts.isExportAssignment);
  if (
    !assignment ||
    !ts.isCallExpression(assignment.expression) ||
    !ts.isIdentifier(assignment.expression.expression) ||
    assignment.expression.expression.text !== "defineConfig"
  ) {
    return undefined;
  }
  if (assignment.expression.arguments.length !== 1) return undefined;
  const [argument] = assignment.expression.arguments;
  return argument && ts.isObjectLiteralExpression(argument)
    ? argument
    : undefined;
}

function hasExpectedConfigStatements(sourceFile, expectedModules) {
  if (
    !sourceFile?.statements ||
    sourceFile.statements.length !== expectedModules.length + 1
  ) {
    return false;
  }
  const imports = sourceFile.statements.slice(0, -1);
  return (
    imports.every(ts.isImportDeclaration) &&
    ts.isExportAssignment(sourceFile.statements.at(-1)) &&
    imports
      .map((statement) =>
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : "",
      )
      .sort()
      .join("\0") === [...expectedModules].sort().join("\0")
  );
}

function hasExactObjectKeys(object, names, spread) {
  if (!object) return false;
  const seen = new Set();
  let spreadSeen = false;
  for (const [index, property] of object.properties.entries()) {
    if (ts.isSpreadAssignment(property)) {
      if (
        spreadSeen ||
        !spread ||
        index !== spread.index ||
        !spread.matches(property.expression)
      )
        return false;
      spreadSeen = true;
      continue;
    }
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      return false;
    }
    if (!names.includes(property.name.text) || seen.has(property.name.text)) {
      return false;
    }
    seen.add(property.name.text);
  }
  return seen.size === names.length && spreadSeen === Boolean(spread);
}

function desktopChromeSpreadAt(index) {
  return {
    index,
    matches: (expression) =>
      ts.isElementAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "devices" &&
      ts.isStringLiteral(expression.argumentExpression) &&
      expression.argumentExpression.text === "Desktop Chrome",
  };
}

function objectProperty(object, name) {
  const values = propertyValues(object, name);
  return values.length === 1 && ts.isObjectLiteralExpression(values[0])
    ? values[0]
    : undefined;
}

function propertyValues(object, name) {
  if (!object) return [];
  return object.properties
    .filter(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === name,
    )
    .map((property) => property.initializer);
}

function hasLiteralProperty(object, name, expected, literalGuard) {
  const values = propertyValues(object, name);
  return (
    values.length === 1 &&
    literalGuard(values[0]) &&
    values[0].text === expected
  );
}

function hasBooleanProperty(object, name, expected) {
  const [value] = propertyValues(object, name);
  return (
    propertyValues(object, name).length === 1 &&
    value?.kind ===
      (expected ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword)
  );
}

function hasNumericProperty(object, name, expected) {
  const values = propertyValues(object, name);
  return (
    values.length === 1 &&
    ts.isNumericLiteral(values[0]) &&
    Number(values[0].text.replaceAll("_", "")) === expected
  );
}

function stringArrayProperty(object, name) {
  const [value] = propertyValues(object, name);
  if (
    propertyValues(object, name).length !== 1 ||
    !value ||
    !ts.isArrayLiteralExpression(value) ||
    !value.elements.every(ts.isStringLiteral)
  ) {
    return undefined;
  }
  return value.elements.map((element) => element.text);
}

function hasExpectedUse(config, storybook) {
  const use = objectProperty(config, "use");
  const keys = [
    "locale",
    "timezoneId",
    "colorScheme",
    "reducedMotion",
    "trace",
  ];
  if (!storybook) keys.unshift("baseURL");
  if (
    !hasExactObjectKeys(
      use,
      keys,
      desktopChromeSpreadAt(storybook ? 0 : keys.length),
    ) ||
    (storybook
      ? propertyValues(use, "baseURL").length !== 0
      : !hasLiteralProperty(
          use,
          "baseURL",
          "http://127.0.0.1:4178",
          ts.isStringLiteral,
        ))
  ) {
    return false;
  }
  return [
    ["locale", "en-GB"],
    ["timezoneId", "UTC"],
    ["colorScheme", "light"],
    ["reducedMotion", "reduce"],
    ["trace", "retain-on-failure"],
  ].every(([name, value]) =>
    hasLiteralProperty(use, name, value, ts.isStringLiteral),
  );
}

function hasExpectedWebServer(config, storybook) {
  const webServer = objectProperty(config, "webServer");
  if (storybook) {
    return (
      hasExactObjectKeys(webServer, [
        "command",
        "url",
        "reuseExistingServer",
        "timeout",
      ]) &&
      hasLiteralProperty(
        webServer,
        "command",
        "pnpm --filter @taskdesk/ui exec storybook dev --ci --port 6006 --host 127.0.0.1",
        ts.isStringLiteral,
      ) &&
      hasLiteralProperty(
        webServer,
        "url",
        "http://127.0.0.1:6006/index.json",
        ts.isStringLiteral,
      ) &&
      hasBooleanProperty(webServer, "reuseExistingServer", false) &&
      hasNumericProperty(webServer, "timeout", 120_000)
    );
  }
  return (
    hasExactObjectKeys(webServer, ["command", "url", "reuseExistingServer"]) &&
    hasLiteralProperty(
      webServer,
      "command",
      "pnpm --filter @taskdesk/web preview --host 127.0.0.1 --port 4178 --strictPort",
      ts.isStringLiteral,
    ) &&
    hasLiteralProperty(
      webServer,
      "url",
      "http://127.0.0.1:4178/auth/sign-in",
      ts.isStringLiteral,
    ) &&
    hasBooleanProperty(webServer, "reuseExistingServer", false)
  );
}

function hasExpectedPortalVisualServer(config) {
  const [value] = propertyValues(config, "webServer");
  if (
    !value ||
    !ts.isArrayLiteralExpression(value) ||
    value.elements.length !== 2
  )
    return false;
  let [agentServer, portalServer] = value.elements;
  if (agentServer && ts.isNonNullExpression(agentServer))
    agentServer = agentServer.expression;
  if (
    !agentServer ||
    !ts.isPropertyAccessExpression(agentServer) ||
    !ts.isIdentifier(agentServer.expression) ||
    agentServer.expression.text !== "base" ||
    agentServer.name.text !== "webServer" ||
    !portalServer ||
    !ts.isObjectLiteralExpression(portalServer)
  )
    return false;
  const env = objectProperty(portalServer, "env");
  return (
    hasExactObjectKeys(portalServer, [
      "command",
      "url",
      "reuseExistingServer",
      "env",
    ]) &&
    hasLiteralProperty(
      portalServer,
      "command",
      "pnpm dev:portal --host 127.0.0.1 --port 4179 --strictPort",
      ts.isStringLiteral,
    ) &&
    hasLiteralProperty(
      portalServer,
      "url",
      "http://127.0.0.1:4179/",
      ts.isStringLiteral,
    ) &&
    hasBooleanProperty(portalServer, "reuseExistingServer", false) &&
    hasExactObjectKeys(env, [])
  );
}

function hasDefaultImport(sourceFile, moduleName, localName) {
  return sourceFile?.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause?.name?.text === localName,
  );
}

function hasNamedImport(sourceFile, moduleName, importName) {
  return sourceFile?.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (specifier) =>
          specifier.name.text === importName &&
          (specifier.propertyName?.text ?? specifier.name.text) === importName,
      ),
  );
}

function hasStorybookSnapshotDirectory(object) {
  const [value] = propertyValues(object, "snapshotDir");
  if (
    propertyValues(object, "snapshotDir").length !== 1 ||
    !value ||
    !ts.isCallExpression(value) ||
    !ts.isIdentifier(value.expression) ||
    value.expression.text !== "fileURLToPath" ||
    value.arguments.length !== 1 ||
    !ts.isNewExpression(value.arguments[0])
  ) {
    return false;
  }
  const url = value.arguments[0];
  return (
    ts.isIdentifier(url.expression) &&
    url.expression.text === "URL" &&
    url.arguments?.length === 2 &&
    ts.isStringLiteral(url.arguments[0]) &&
    url.arguments[0].text === "../../packages/ui/src/components/" &&
    ts.isPropertyAccessExpression(url.arguments[1]) &&
    url.arguments[1].name.text === "url" &&
    ts.isMetaProperty(url.arguments[1].expression) &&
    url.arguments[1].expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    url.arguments[1].expression.name.text === "meta"
  );
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
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
      if (
        moduleName !== "@playwright/test" ||
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

  const isAllowedPlaywrightApiReference = (node) => {
    const parent = node.parent;
    const allowedDirectPropertyCalls = {
      test: new Set(["setTimeout"]),
      expect: new Set(["poll", "soft"]),
    };
    return (
      (ts.isImportSpecifier(parent) && parent.name === node) ||
      (ts.isCallExpression(parent) && parent.expression === node) ||
      (ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        allowedDirectPropertyCalls[node.text]?.has(parent.name.text) &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent)
    );
  };

  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isIdentifier(node) &&
      (node.text === "test" || node.text === "expect") &&
      !isAllowedPlaywrightApiReference(node)
    ) {
      unsafe = true;
      return;
    }
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

function screenshotOptionsHaveFullPage(node) {
  const options = unwrapTypeWrappers(node);
  if (
    !ts.isObjectLiteralExpression(options) ||
    options.properties.length < 2 ||
    options.properties.length > 7 ||
    !literalScreenshotOptionValue(options)
  ) {
    return false;
  }
  const expectedValues = new Map([
    ["fullPage", (value) => value.kind === ts.SyntaxKind.TrueKeyword],
    [
      "maxDiffPixels",
      (value) => ts.isNumericLiteral(value) && value.text === "0",
    ],
    ["threshold", (value) => ts.isNumericLiteral(value) && value.text === "0"],
    ["includeAA", (value) => value.kind === ts.SyntaxKind.TrueKeyword],
    [
      "animations",
      (value) => ts.isStringLiteral(value) && value.text === "disabled",
    ],
    ["caret", (value) => ts.isStringLiteral(value) && value.text === "hide"],
    ["scale", (value) => ts.isStringLiteral(value) && value.text === "css"],
  ]);
  const values = new Map();
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
    const matchesExpectedValue = expectedValues.get(name);
    if (!matchesExpectedValue || values.has(name)) {
      return false;
    }
    const value = unwrapTypeWrappers(property.initializer);
    if (!matchesExpectedValue(value)) return false;
    values.set(name, value);
  }
  return (
    values.has("fullPage") &&
    values.has("maxDiffPixels") &&
    values.has("threshold") &&
    values.has("includeAA")
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
  const screenshot = statement.expression.expression;
  const [name, options] = screenshot.arguments;
  if (
    screenshot.arguments.length !== 2 ||
    !ts.isStringLiteral(name) ||
    !isExpectingPage(screenshot.expression.expression) ||
    !options ||
    !screenshotOptionsHaveFullPage(options)
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

function containsPageFixtureReference(node) {
  let found = false;
  const visit = (current) => {
    if (found) return;
    const isPropertyName =
      (ts.isPropertyAccessExpression(current.parent) &&
        current.parent.name === current) ||
      (ts.isPropertyAssignment(current.parent) &&
        current.parent.name === current);
    if (
      ts.isIdentifier(current) &&
      current.text === "page" &&
      !isPropertyName
    ) {
      found = true;
      return;
    }
    current.forEachChild(visit);
  };
  visit(node);
  return found;
}

function isAllowedStoryRootLocator(initializer) {
  const expression = unwrapTypeWrappers(initializer);
  return (
    ts.isCallExpression(expression) &&
    isNamedProperty(expression.expression, "locator") &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "page"
  );
}

function hasPageObjectAlias(callback) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      containsPageFixtureReference(node.initializer) &&
      !isAllowedStoryRootLocator(node.initializer)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      containsPageFixtureReference(node.right)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "goto" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "page" &&
      !(
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node &&
        ts.isAwaitExpression(node.parent.parent) &&
        node.parent.parent.expression === node.parent &&
        ts.isExpressionStatement(node.parent.parent.parent) &&
        node.parent.parent.parent.expression === node.parent.parent &&
        isStoryNavigation(node.parent.parent.parent)
      )
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(callback.body);
  return unsafe;
}

function hasUnknownPageOperation(callback) {
  const allowedPageMethods = new Set([
    "evaluate",
    "getByRole",
    "goto",
    "locator",
  ]);
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === "evaluateHandle" || node.name.text === "evaluateAll")
    ) {
      // These APIs add no required G8 evidence and can execute opaque source or
      // return handles that bypass the canonical read-only evaluate callbacks.
      // Reject them for every receiver, including locator aliases.
      unsafe = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === "evaluateHandle" || node.text === "evaluateAll") &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      // Also reject extracted or destructured method aliases.
      unsafe = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "page" &&
      (!allowedPageMethods.has(node.name.text) ||
        !ts.isCallExpression(node.parent) ||
        node.parent.expression !== node)
    ) {
      unsafe = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const passesPage = node.arguments.some(containsPageFixtureReference);
      const isPageExpectation =
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "expect" &&
          ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === "page") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "expect" &&
          node.expression.name.text === "soft" &&
          ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === "page") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "expect" &&
          node.expression.name.text === "poll");
      if (passesPage && !isPageExpectation) {
        unsafe = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(callback.body);
  return unsafe;
}

function collectMatchingNodes(node, predicate) {
  const matches = [];
  const visit = (current) => {
    if (predicate(current)) matches.push(current);
    current.forEachChild(visit);
  };
  visit(node);
  return matches;
}

function normalizedCallbackText(callback) {
  return callback.getText().replace(/\s+/gu, "").replace(/,\)/gu, ")");
}

function isWithinNode(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function isStoryReadinessCallback(callback) {
  return (
    ts.isArrowFunction(callback) &&
    normalizedCallbackText(callback) ===
      'async()=>{conststoryRoot=page.locator("#storybook-root");conststoryRendered=awaitstoryRoot.evaluate((root)=>root.childElementCount>0||Boolean(root.textContent?.trim()));returnstoryRendered||(awaitpage.getByRole("dialog").isVisible());}'
  );
}

function isStoryRootReadCallback(callback) {
  return (
    ts.isArrowFunction(callback) &&
    normalizedCallbackText(callback) ===
      "(root)=>root.childElementCount>0||Boolean(root.textContent?.trim())"
  );
}

function isFontsReadyCallback(callback) {
  return (
    ts.isArrowFunction(callback) &&
    normalizedCallbackText(callback) ===
      "async()=>{awaitdocument.fonts.ready;awaitnewPromise<void>((resolve)=>requestAnimationFrame(()=>resolve()));}"
  );
}

function hasReadOnlyStoryCaptureCallbacks(callback, loop) {
  if (!ts.isBlock(callback.body) || !ts.isBlock(loop.statement)) return false;
  const loopBody = loop.statement;
  const calls = collectMatchingNodes(loopBody, ts.isCallExpression);
  const callsWithProperty = (name, receiver) =>
    calls.filter(
      (call) =>
        isNamedProperty(call.expression, name) &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === receiver,
    );
  const pageEvaluateCalls = callsWithProperty("evaluate", "page");
  const locatorEvaluateCalls = callsWithProperty("evaluate", "storyRoot");
  const allEvaluateCalls = calls.filter((call) =>
    isNamedProperty(call.expression, "evaluate"),
  );
  const readinessCalls = calls.filter(
    (call) =>
      isNamedProperty(call.expression, "poll") &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === "expect",
  );
  const locatorCalls = callsWithProperty("locator", "page");
  const dialogCalls = callsWithProperty("getByRole", "page");
  const dialogVisibilityCalls = calls.filter(
    (call) =>
      isNamedProperty(call.expression, "isVisible") &&
      ts.isCallExpression(call.expression.expression) &&
      isNamedProperty(call.expression.expression.expression, "getByRole") &&
      ts.isIdentifier(call.expression.expression.expression.expression) &&
      call.expression.expression.expression.expression.text === "page",
  );
  const readinessCallback = readinessCalls[0]?.arguments[0];
  const fontWaitCallback = pageEvaluateCalls[0]?.arguments[0];
  const browserDocumentReferences = collectMatchingNodes(
    callback.body,
    (node) =>
      ts.isIdentifier(node) &&
      (node.text === "document" || node.text === "requestAnimationFrame"),
  );
  const storyRootReferences = collectMatchingNodes(
    callback.body,
    (node) => ts.isIdentifier(node) && node.text === "storyRoot",
  );
  const isReadinessAssertion = (statement) => {
    return (
      ts.isExpressionStatement(statement) &&
      readinessCalls.length === 1 &&
      normalizedCallbackText(statement) ===
        `awaitexpect.poll(${normalizedCallbackText(readinessCalls[0].arguments[0])}).toBe(true);`
    );
  };
  const readinessAssertionStatements =
    loopBody.statements.filter(isReadinessAssertion);

  return (
    pageEvaluateCalls.length === 1 &&
    locatorEvaluateCalls.length === 1 &&
    allEvaluateCalls.length === 2 &&
    readinessCalls.length === 1 &&
    readinessCalls[0].arguments.length === 1 &&
    isStoryReadinessCallback(readinessCallback) &&
    isStoryRootReadCallback(locatorEvaluateCalls[0].arguments[0]) &&
    isFontsReadyCallback(fontWaitCallback) &&
    browserDocumentReferences.every((node) =>
      isWithinNode(node, fontWaitCallback),
    ) &&
    storyRootReferences.length === 2 &&
    storyRootReferences.every((node) =>
      isWithinNode(node, readinessCallback),
    ) &&
    locatorCalls.length === 1 &&
    locatorCalls[0].arguments.length === 1 &&
    ts.isStringLiteral(locatorCalls[0].arguments[0]) &&
    locatorCalls[0].arguments[0].text === "#storybook-root" &&
    dialogCalls.length === 1 &&
    dialogCalls[0].arguments.length === 1 &&
    ts.isStringLiteral(dialogCalls[0].arguments[0]) &&
    dialogCalls[0].arguments[0].text === "dialog" &&
    dialogVisibilityCalls.length === 1 &&
    dialogVisibilityCalls[0].arguments.length === 0 &&
    readinessAssertionStatements.length === 1 &&
    collectMatchingNodes(
      callback.body,
      (node) =>
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node),
    ).length === 9
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

function isEnrollmentReadinessStatement(statement) {
  if (!ts.isExpressionStatement(statement)) return false;
  const normalized = statement
    .getText()
    .replaceAll("'", '"')
    .replace(/\s+/gu, " ")
    .trim();
  return (
    normalized ===
      'await page.locator("#factor-password").fill("visual-enrollment-password");' ||
    /^await expect\( ?page\.getByRole\("button", \{ name: "Set up authenticator" \}\),? ?\)\.toBeEnabled\(\);$/u.test(
      normalized,
    )
  );
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

function testVisualEvidence(callback) {
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
      evidence: awaitedScreenshotName(statement),
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
  origin,
) {
  // Visual route tests use a concrete path through Playwright's configured base
  // URL. Require that the path itself is the app route; an alias or redirect
  // must be declared explicitly in the manifest instead of silently standing in
  // for the screen being measured.
  let actualUrl;
  if (origin === "portal") {
    try {
      actualUrl = new URL(navigation);
    } catch {
      return false;
    }
    if (actualUrl.origin !== "http://127.0.0.1:4179") return false;
  } else {
    if (!navigation.startsWith("/") || navigation.startsWith("//"))
      return false;
    actualUrl = new URL(navigation, "http://visual.invalid");
  }
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

function isStoryNavigation(statement, storyName = "story") {
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
    url.head.text === "http://127.0.0.1:6006/iframe.html?id=" &&
    url.templateSpans.length === 1 &&
    ts.isPropertyAccessExpression(url.templateSpans[0].expression) &&
    url.templateSpans[0].expression.name.text === "id" &&
    ts.isIdentifier(url.templateSpans[0].expression.expression) &&
    url.templateSpans[0].expression.expression.text === storyName &&
    url.templateSpans[0].literal.text === "&viewMode=story"
  );
}

function isPageScreenshotCall(node) {
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
    screenshotOptionsHaveFullPage(options)
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

function isStoryBindingDeclaration(node) {
  return (
    (ts.isVariableDeclaration(node) ||
      ts.isParameterDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isBindingElement(node) ||
      ts.isImportClause(node) ||
      ts.isImportSpecifier(node)) &&
    node.name &&
    bindingContainsName(node.name, "story")
  );
}

function assignmentRootIdentifier(node) {
  let target = node;
  while (
    ts.isPropertyAccessExpression(target) ||
    ts.isElementAccessExpression(target)
  ) {
    target = target.expression;
  }
  return ts.isIdentifier(target) ? target.text : undefined;
}

function hasImmutableStoryBinding(loop, loopDeclaration) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    if (isStoryBindingDeclaration(node) && node !== loopDeclaration) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      assignmentRootIdentifier(node.left) === "story"
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isDeleteExpression(node) &&
      assignmentRootIdentifier(node.expression) === "story"
    ) {
      unsafe = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      assignmentRootIdentifier(node.operand) === "story"
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(loop.statement);
  return !unsafe;
}

function hasPlatformFetchBinding(sourceFile) {
  let unsafe = false;
  const visit = (node) => {
    if (unsafe) return;
    const namedFunctionBinding =
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name?.text === "fetch";
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameterDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node)) &&
      node.name &&
      bindingContainsName(node.name, "fetch")
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isCatchClause(node) &&
      node.variableDeclaration &&
      bindingContainsName(node.variableDeclaration.name, "fetch")
    ) {
      unsafe = true;
      return;
    }
    if (namedFunctionBinding) {
      unsafe = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      assignmentRootIdentifier(node.left) === "fetch"
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isDeleteExpression(node) &&
      assignmentRootIdentifier(node.expression) === "fetch"
    ) {
      unsafe = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      assignmentRootIdentifier(node.operand) === "fetch"
    ) {
      unsafe = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return !unsafe;
}

function isCanonicalStorybookIndexFetch(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "fetch" &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === "http://127.0.0.1:6006/index.json"
  );
}

function isValidatedRouteRequest(node) {
  let current = node;
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const call = current.parent;
      return (
        ts.isCallExpression(call) &&
        call.arguments.includes(current) &&
        isNamedProperty(call.expression, "route") &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === "page" &&
        ts.isStringLiteral(call.arguments[0]) &&
        call.arguments[0].text === "**/api/**" &&
        call.arguments[1] === current &&
        hasSafeApiRouteHandler(current)
      );
    }
    current = current.parent;
  }
  return false;
}

function hasSafeNetworkCapabilities(sourceFile, allowStorybookIndexFetch) {
  if (!sourceFile) return false;
  const fetchCalls = [];
  let unsafe = false;
  const networkGlobals = new Set([
    "APIRequestContext",
    "EventSource",
    "XMLHttpRequest",
    "WebSocket",
    "WebTransport",
    "navigator",
    "sendBeacon",
  ]);
  const isPropertyName = (node) =>
    (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
    (ts.isPropertyDeclaration(node.parent) && node.parent.name === node);
  const isRouteRequest = (node) =>
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "request" &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "route" &&
    isValidatedRouteRequest(node);
  const isCallableCallback = (node) =>
    ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  const visit = (node) => {
    if (unsafe) return;
    if (
      (ts.isPropertyAccessExpression(node) &&
        (node.name.text === "evaluateHandle" ||
          node.name.text === "evaluateAll")) ||
      (ts.isIdentifier(node) &&
        (node.text === "evaluateHandle" || node.text === "evaluateAll"))
    ) {
      // Neither method is required for the canonical visual fixtures. Reject
      // direct calls, property aliases, and destructured method aliases before
      // their arguments can hide browser execution from this source scan.
      unsafe = true;
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      unsafe = true;
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "fetch") fetchCalls.push(node);
      if (node.expression.text === "sendBeacon") unsafe = true;
    }
    if (
      ts.isIdentifier(node) &&
      !isPropertyName(node) &&
      networkGlobals.has(node.text)
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === "setTimeout" || node.text === "setInterval") &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node &&
        ts.isIdentifier(node.parent.expression) &&
        node.parent.expression.text === "test" &&
        node.text === "setTimeout" &&
        ts.isCallExpression(node.parent.parent) &&
        node.parent.parent.expression === node.parent
      )
    ) {
      // Timer aliases can defer opaque strings past the synchronous source scan.
      unsafe = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "fetch" &&
      !(
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node &&
        isCanonicalStorybookIndexFetch(node.parent)
      )
    ) {
      unsafe = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ((node.name.text === "request" && !isRouteRequest(node)) ||
        node.name.text === "fetch" ||
        node.name.text === "sendBeacon")
    ) {
      unsafe = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const operation = ts.isIdentifier(expression)
        ? expression.text
        : ts.isPropertyAccessExpression(expression)
          ? expression.name.text
          : undefined;
      if (
        operation === "evaluate" &&
        (!ts.isPropertyAccessExpression(expression) ||
          node.arguments.length === 0 ||
          !isCallableCallback(unwrapTypeWrappers(node.arguments[0])))
      ) {
        // Playwright also accepts source strings here; they hide browser network APIs
        // from this AST check. Only callback execution can be inspected structurally.
        unsafe = true;
        return;
      }
      if (
        (operation === "setTimeout" || operation === "setInterval") &&
        !(
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "test" &&
          operation === "setTimeout"
        ) &&
        (node.arguments.length === 0 ||
          !isCallableCallback(unwrapTypeWrappers(node.arguments[0])))
      ) {
        unsafe = true;
        return;
      }
      if (
        ts.isIdentifier(expression) &&
        (expression.text === "eval" || expression.text === "Function")
      ) {
        unsafe = true;
        return;
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Function"
    ) {
      unsafe = true;
      return;
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        new Set([
          "EventSource",
          "Request",
          "WebSocket",
          "WebTransport",
          "XMLHttpRequest",
        ]).has(node.expression.text)
      ) {
        unsafe = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  if (unsafe) return false;
  if (!allowStorybookIndexFetch) return fetchCalls.length === 0;
  return (
    fetchCalls.length === 1 && isCanonicalStorybookIndexFetch(fetchCalls[0])
  );
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
    (loop.initializer.flags & ts.NodeFlags.Const) === 0 ||
    !ts.isIdentifier(loop.expression) ||
    loop.expression.text !== "stories" ||
    !ts.isBlock(loop.statement)
  ) {
    return false;
  }
  if (!hasImmutableStoryBinding(loop, declaration)) return false;
  if (hasPageObjectAlias(callback)) return false;
  if (hasUnknownPageOperation(callback)) return false;
  if (!hasReadOnlyStoryCaptureCallbacks(callback, loop)) return false;
  if (hasStoryLoopControlBypass(loop)) return false;

  const navigationStatements = loop.statement.statements.filter((statement) =>
    isStoryNavigation(statement, declaration.name.text),
  );
  let pageNavigationCount = 0;
  const countPageNavigations = (node) => {
    if (isPageNavigationCall(node)) pageNavigationCount += 1;
    node.forEachChild(countPageNavigations);
  };
  countPageNavigations(callback.body);
  const screenshotStatements = loop.statement.statements.filter((statement) => {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isAwaitExpression(statement.expression) ||
      !isPageScreenshotCall(statement.expression.expression)
    ) {
      return false;
    }
    return isStoryScreenshotTemplate(
      statement.expression.expression.arguments[0],
    );
  });
  return (
    pageNavigationCount === 1 &&
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
    hasPlatformFetchBinding(sourceFile) &&
    fetchesStoryIndex &&
    hasFrozenStorybookIndex(callback) &&
    derivesStoriesFromEveryExport &&
    !hasObjectIntrinsicMutation(sourceFile) &&
    !hasDynamicCodeExecution(sourceFile) &&
    statements.some(isNonemptyStoriesAssertion) &&
    !hasStoryCoverageControlBypass(callback) &&
    !hasStoryArrayMutation(callback) &&
    hasStoryScreenshotLoop(callback)
  );
}

function splitInventoryTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return undefined;
  if (!trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isInventoryTableSeparator(cells) {
  return cells.every((cell) => /^:?-+:?$/u.test(cell));
}

const inventoryRows = [];
let readingScreenTable = false;
let screenTableCount = 0;
const inventoryLines = inventory.split(/\r?\n/u);
for (const [index, line] of inventoryLines.entries()) {
  const cells = splitInventoryTableRow(line);
  if (
    cells &&
    cells.map((cell) => cell.toLowerCase()).join("|") ===
      "screen|route|kind|stage|status"
  ) {
    screenTableCount += 1;
    readingScreenTable = true;
    continue;
  }
  if (!readingScreenTable) continue;
  if (cells === undefined) {
    if (line.trim() === "") {
      readingScreenTable = false;
      continue;
    }
    if (/^\s*#{1,6}\s/u.test(line)) {
      readingScreenTable = false;
      continue;
    }
    failures.push(
      `screen inventory line ${index + 1} has a malformed table row`,
    );
    continue;
  }
  if (cells === null) {
    failures.push(
      `screen inventory line ${index + 1} has a malformed table row`,
    );
    continue;
  }
  if (isInventoryTableSeparator(cells)) continue;
  if (cells.length !== 5) {
    failures.push(
      `screen inventory line ${index + 1} has a malformed table row`,
    );
    continue;
  }
  const [name, routeCell, kind, stage, status] = cells;
  const routeMatch = routeCell.match(/^`([^`]+)`$/u);
  if (
    !name ||
    !new Set(["route", "overlay", "dialog", "section"]).has(kind) ||
    (kind === "route" && !routeMatch) ||
    (kind !== "route" && !routeCell) ||
    !/^P\d+$/u.test(stage) ||
    !new Set(["⬜", "🟡", "✅", "🔒"]).has(status)
  ) {
    failures.push(
      `screen inventory line ${index + 1} has a malformed table row`,
    );
    continue;
  }
  if (kind === "route") {
    inventoryRows.push({ name, route: routeMatch?.[1], status });
  }
}
if (screenTableCount === 0) {
  failures.push(
    `${inventoryPath} must contain at least one canonical Screen inventory table`,
  );
}
if (inventoryRows.length === 0) {
  failures.push(
    `${inventoryPath} must contain at least one route-kind inventory row`,
  );
}
const inventoryRoutes = new Set(inventoryRows.map(({ route }) => route));
const activeInventoryRows = inventoryRows.filter(({ status }) =>
  /[🟡✅]/u.test(status),
);
const appRoutes = new Set(
  routeTrees.flatMap((routeTree) => {
    const paths = [...routeTree.matchAll(/fullPath: '([^']+)'/gu)].map(
      ([, route]) => route,
    );
    const fullPaths = routeTree.match(
      /export interface FileRouteTypes \{[\s\S]*?\n\s*fullPaths:\s*([\s\S]*?)\n\s*fileRoutesByTo:/u,
    )?.[1];
    if (fullPaths)
      paths.push(
        ...[...fullPaths.matchAll(/'([^']+)'/gu)].map(([, route]) => route),
      );
    return paths;
  }),
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
const baseConfigFilePath = path.join(repoRoot, baseConfigPath);
const visualConfigFilePath = path.join(repoRoot, visualConfigPath);
const storybookConfigFilePath = path.join(repoRoot, storybookConfigPath);
const parser = new API({ cwd: repoRoot });
let visualSourceFile;
let storySourceFile;
let baseConfigSourceFile;
let visualConfigSourceFile;
let storybookConfigSourceFile;
try {
  const snapshot = parser.updateSnapshot({
    openFiles: [
      visualSpecPath,
      storySpecPath,
      baseConfigFilePath,
      visualConfigFilePath,
      storybookConfigFilePath,
    ],
  });
  try {
    const visualProject = snapshot.getDefaultProjectForFile(visualSpecPath);
    const storyProject = snapshot.getDefaultProjectForFile(storySpecPath);
    const baseConfigProject =
      snapshot.getDefaultProjectForFile(baseConfigFilePath);
    const visualConfigProject =
      snapshot.getDefaultProjectForFile(visualConfigFilePath);
    const storybookConfigProject = snapshot.getDefaultProjectForFile(
      storybookConfigFilePath,
    );
    visualSourceFile = visualProject?.program.getSourceFile(visualSpecPath);
    storySourceFile = storyProject?.program.getSourceFile(storySpecPath);
    baseConfigSourceFile =
      baseConfigProject?.program.getSourceFile(baseConfigFilePath);
    visualConfigSourceFile =
      visualConfigProject?.program.getSourceFile(visualConfigFilePath);
    storybookConfigSourceFile = storybookConfigProject?.program.getSourceFile(
      storybookConfigFilePath,
    );
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
    const configFiles = [
      [
        baseConfigPath,
        baseConfigFilePath,
        baseConfigProject,
        baseConfigSourceFile,
      ],
      [
        visualConfigPath,
        visualConfigFilePath,
        visualConfigProject,
        visualConfigSourceFile,
      ],
      [
        storybookConfigPath,
        storybookConfigFilePath,
        storybookConfigProject,
        storybookConfigSourceFile,
      ],
    ];
    for (const [
      relativePath,
      absolutePath,
      project,
      sourceFile,
    ] of configFiles) {
      if (
        !sourceFile ||
        project.program.getSyntacticDiagnostics(absolutePath).length > 0
      ) {
        failures.push(
          `${relativePath} could not be parsed for G8 launch evidence`,
        );
      }
    }
    const baseConfig = configObject(baseConfigSourceFile);
    const visualConfig = configObject(visualConfigSourceFile);
    const storybookConfig = configObject(storybookConfigSourceFile);
    const baseTestIgnores = stringArrayProperty(baseConfig, "testIgnore");
    if (
      !hasExpectedConfigStatements(baseConfigSourceFile, [
        "@playwright/test",
      ]) ||
      !hasExactObjectKeys(baseConfig, [
        "testDir",
        "fullyParallel",
        "workers",
        "testIgnore",
        "forbidOnly",
        "retries",
        "reporter",
        "use",
        "webServer",
      ]) ||
      !hasNamedImport(
        baseConfigSourceFile,
        "@playwright/test",
        "defineConfig",
      ) ||
      !hasNamedImport(baseConfigSourceFile, "@playwright/test", "devices") ||
      !hasLiteralProperty(baseConfig, "testDir", "./e2e", ts.isStringLiteral) ||
      !hasBooleanProperty(baseConfig, "fullyParallel", true) ||
      !hasNumericProperty(baseConfig, "workers", 1) ||
      !hasBooleanProperty(baseConfig, "forbidOnly", true) ||
      !hasNumericProperty(baseConfig, "retries", 0) ||
      !hasLiteralProperty(baseConfig, "reporter", "list", ts.isStringLiteral) ||
      !hasExpectedUse(baseConfig, false) ||
      !hasExpectedWebServer(baseConfig, false) ||
      !baseTestIgnores?.includes("visual.spec.ts") ||
      !baseTestIgnores.includes("storybook-visual.spec.ts") ||
      baseTestIgnores.length !== 2
    ) {
      failures.push(
        `${baseConfigPath} must define the e2e directory and exclude both separately guarded visual specs from the default suite`,
      );
    }
    const visualTestIgnores = stringArrayProperty(visualConfig, "testIgnore");
    if (
      !hasExpectedConfigStatements(visualConfigSourceFile, [
        "@playwright/test",
        "./playwright.config",
      ]) ||
      !hasExactObjectKeys(
        visualConfig,
        [
          "fullyParallel",
          "workers",
          "testIgnore",
          "testMatch",
          "updateSnapshots",
          "webServer",
        ],
        {
          index: 0,
          matches: (expression) =>
            ts.isIdentifier(expression) && expression.text === "base",
        },
      ) ||
      !hasNamedImport(
        visualConfigSourceFile,
        "@playwright/test",
        "defineConfig",
      ) ||
      !hasDefaultImport(
        visualConfigSourceFile,
        "./playwright.config",
        "base",
      ) ||
      !hasBooleanProperty(visualConfig, "fullyParallel", false) ||
      !hasNumericProperty(visualConfig, "workers", 1) ||
      !hasLiteralProperty(
        visualConfig,
        "testMatch",
        "visual.spec.ts",
        ts.isStringLiteral,
      ) ||
      !hasLiteralProperty(
        visualConfig,
        "updateSnapshots",
        "none",
        ts.isStringLiteral,
      ) ||
      !visualTestIgnores ||
      visualTestIgnores.length !== 0 ||
      !hasExpectedPortalVisualServer(visualConfig) ||
      propertyValues(visualConfig, "testDir").length !== 0
    ) {
      failures.push(
        `${visualConfigPath} must extend the app Playwright config and select the route visual spec serially`,
      );
    }
    if (
      !hasExpectedConfigStatements(storybookConfigSourceFile, [
        "node:url",
        "@playwright/test",
      ]) ||
      !hasExactObjectKeys(storybookConfig, [
        "testDir",
        "testMatch",
        "fullyParallel",
        "forbidOnly",
        "updateSnapshots",
        "retries",
        "reporter",
        "snapshotDir",
        "snapshotPathTemplate",
        "use",
        "webServer",
      ]) ||
      !hasNamedImport(
        storybookConfigSourceFile,
        "@playwright/test",
        "defineConfig",
      ) ||
      !hasNamedImport(
        storybookConfigSourceFile,
        "@playwright/test",
        "devices",
      ) ||
      !hasNamedImport(storybookConfigSourceFile, "node:url", "fileURLToPath") ||
      !hasStorybookSnapshotDirectory(storybookConfig) ||
      !hasLiteralProperty(
        storybookConfig,
        "testDir",
        "./e2e",
        ts.isStringLiteral,
      ) ||
      !hasLiteralProperty(
        storybookConfig,
        "testMatch",
        "storybook-visual.spec.ts",
        ts.isStringLiteral,
      ) ||
      !hasLiteralProperty(
        storybookConfig,
        "snapshotPathTemplate",
        "{snapshotDir}/{arg}-{projectName}-{platform}{ext}",
        ts.isStringLiteral,
      ) ||
      !hasBooleanProperty(storybookConfig, "fullyParallel", false) ||
      !hasBooleanProperty(storybookConfig, "forbidOnly", true) ||
      !hasNumericProperty(storybookConfig, "retries", 0) ||
      !hasLiteralProperty(
        storybookConfig,
        "reporter",
        "list",
        ts.isStringLiteral,
      ) ||
      !hasExpectedUse(storybookConfig, true) ||
      !hasExpectedWebServer(storybookConfig, true) ||
      !hasLiteralProperty(
        storybookConfig,
        "updateSnapshots",
        "none",
        ts.isStringLiteral,
      ) ||
      propertyValues(storybookConfig, "testIgnore").length !== 0
    ) {
      failures.push(
        `${storybookConfigPath} must select the Storybook visual spec, compare checked-in story baselines serially, forbid focused tests, and start Storybook`,
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
        `${path.basename(visualSpecPath)} contains unsafe runtime code`,
      );
    }
    if (storySourceFile && !hasSafeVisualTestRuntime(storySourceFile)) {
      failures.push(
        `${path.basename(storySpecPath)} contains unsafe runtime code`,
      );
    }
    if (
      visualSourceFile &&
      !hasSafeNetworkCapabilities(visualSourceFile, false)
    ) {
      failures.push(
        `${path.basename(visualSpecPath)} uses a network capability outside its local Playwright API-route fixture`,
      );
    }
    if (storySourceFile && !hasSafeNetworkCapabilities(storySourceFile, true)) {
      failures.push(
        `${path.basename(storySpecPath)} may only fetch the canonical Storybook index once without request options`,
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
  if (screen.origin !== undefined && screen.origin !== "portal")
    failures.push(`${screen.name} has an unsupported visual origin`);
  if (screen.origin === "portal" && screen.applicationRoute !== "/")
    failures.push(
      `${screen.name} portal visual route must use the independent root path`,
    );
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
    testVisualEvidence(callback),
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
      `${screen.name} test does not capture its declared screenshot baseline directly`,
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
        screen.origin,
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
          (statement) =>
            !isVisibleAssertionStatement(statement) &&
            !isEnrollmentReadinessStatement(statement),
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
    if (
      !activeInventoryRows.some(({ route }) => route === screen.inventoryRoute)
    ) {
      failures.push(
        `${screen.name} references an inventory route that is not marked in progress or complete`,
      );
    }
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
    failures.push(`${screen.name} route is missing from ${routeTreeLabel}`);
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
      `in-progress or complete inventory route ${name} (${route}) is missing from ${routeTreeLabel}`,
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
    `G8 scope check passed: ${manifest.length} screenshot cases, ${activeInventoryRows.length} active inventory route rows mapped (${inventoryRows.length} route rows total). Storybook story coverage is checked at runtime.`,
  );
}

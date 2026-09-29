#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  createScanner,
  LanguageVariant,
  SyntaxKind,
} from "typescript/unstable/ast";
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

function visualTestScreenshots(source) {
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      value: scanner.getTokenValue(),
    });
  }

  const openToClose = new Map([
    [SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken],
    [SyntaxKind.OpenBraceToken, SyntaxKind.CloseBraceToken],
    [SyntaxKind.OpenBracketToken, SyntaxKind.CloseBracketToken],
  ]);
  const closeTokens = new Set(openToClose.values());
  const testCases = new Map();

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (
      tokens[index].kind !== SyntaxKind.Identifier ||
      tokens[index].text !== "test" ||
      tokens[index + 1].kind !== SyntaxKind.OpenParenToken
    ) {
      continue;
    }

    const callOpen = index + 1;
    const delimiters = [SyntaxKind.CloseParenToken];
    let callClose = -1;
    let argumentSeparator = -1;
    for (let cursor = callOpen + 1; cursor < tokens.length; cursor += 1) {
      const kind = tokens[cursor].kind;
      if (
        delimiters.length === 1 &&
        kind === SyntaxKind.CommaToken &&
        argumentSeparator < 0
      ) {
        argumentSeparator = cursor;
      }
      if (openToClose.has(kind)) {
        delimiters.push(openToClose.get(kind));
      } else if (closeTokens.has(kind)) {
        if (delimiters.pop() !== kind) break;
        if (delimiters.length === 0 && kind === SyntaxKind.CloseParenToken) {
          callClose = cursor;
          break;
        }
      }
    }

    const title = tokens[callOpen + 1];
    if (
      callClose < 0 ||
      argumentSeparator < 0 ||
      title?.kind !== SyntaxKind.StringLiteral
    ) {
      continue;
    }

    let arrow = -1;
    for (let cursor = argumentSeparator + 1; cursor < callClose; cursor += 1) {
      if (tokens[cursor].kind === SyntaxKind.EqualsGreaterThanToken) {
        arrow = cursor;
        break;
      }
    }

    const screenshots = new Set();
    const bodyStart = arrow + 1;
    if (arrow >= 0 && tokens[bodyStart]?.kind === SyntaxKind.OpenBraceToken) {
      const bodyDelimiters = [SyntaxKind.CloseBraceToken];
      let bodyEnd = -1;
      for (let cursor = bodyStart + 1; cursor < callClose; cursor += 1) {
        const kind = tokens[cursor].kind;
        if (openToClose.has(kind)) {
          bodyDelimiters.push(openToClose.get(kind));
        } else if (closeTokens.has(kind)) {
          if (bodyDelimiters.pop() !== kind) break;
          if (bodyDelimiters.length === 0) {
            bodyEnd = cursor;
            break;
          }
        }
      }
      if (bodyEnd >= 0) {
        collectScreenshotAssertions(
          tokens,
          bodyStart + 1,
          bodyEnd,
          screenshots,
        );
      }
    } else if (arrow >= 0) {
      collectScreenshotAssertions(tokens, bodyStart, callClose, screenshots);
    }

    const matches = testCases.get(title.value) ?? [];
    matches.push(screenshots);
    testCases.set(title.value, matches);
  }

  return testCases;
}

function collectScreenshotAssertions(tokens, start, end, screenshots) {
  for (let index = start; index + 3 < end; index += 1) {
    if (
      tokens[index].kind === SyntaxKind.DotToken &&
      tokens[index + 1].kind === SyntaxKind.Identifier &&
      tokens[index + 1].text === "toHaveScreenshot" &&
      tokens[index + 2].kind === SyntaxKind.OpenParenToken &&
      tokens[index + 3].kind === SyntaxKind.StringLiteral
    ) {
      screenshots.add(tokens[index + 3].value);
    }
  }
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
const visualSpec = await readFile(
  path.join(repoRoot, "apps/web/e2e/visual.spec.ts"),
  "utf8",
);
const screenshotsByTest = visualTestScreenshots(visualSpec);
for (const screen of manifest) {
  if (seenTests.has(screen.test))
    failures.push(`duplicate test name: ${screen.test}`);
  seenTests.add(screen.test);
  if (!screen.test.endsWith("@visual")) {
    failures.push(`${screen.name} test is not tagged @visual`);
  }
  const matchingTests = screenshotsByTest.get(screen.test) ?? [];
  if (matchingTests.length === 0) {
    failures.push(
      `${screen.name} has no matching test in apps/web/e2e/visual.spec.ts`,
    );
  } else if (matchingTests.length > 1) {
    failures.push(
      `${screen.name} has duplicate tests named ${JSON.stringify(screen.test)} in apps/web/e2e/visual.spec.ts`,
    );
  } else if (!matchingTests[0].has(screen.screenshot)) {
    failures.push(
      `${screen.name} test does not capture its declared screenshot baseline`,
    );
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

const storySpec = await readFile(
  path.join(repoRoot, "apps/web/e2e/storybook-visual.spec.ts"),
  "utf8",
);
if (
  !storySpec.includes(
    "every exported Storybook story has a visual baseline @visual",
  )
) {
  failures.push(
    "Storybook visual test must enumerate every exported story and capture a baseline",
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

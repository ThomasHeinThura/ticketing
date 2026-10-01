import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBetterAuthPluginIds, loadRouterRoutes } from "./api-app";

const LOCKFILE = fileURLToPath(
  new URL("../../pnpm-lock.yaml", import.meta.url),
);
const FORBIDDEN_ROUTE_PATTERN =
  /public-project|github|gitea|slack|discord|telegram|generic-webhook/i;
const FORBIDDEN_PACKAGE_NAMES = new Set(["octokit", "@octokit/webhooks"]);
const FORBIDDEN_AUTH_PLUGINS = new Set([
  "anonymous",
  "device-authorization",
  "bearer",
]);

function hasInheritedIntegrationRoute(path: string): boolean {
  return FORBIDDEN_ROUTE_PATTERN.test(path);
}

function unquote(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function packageNameFromLockKey(key: string): string | undefined {
  const separator = key.startsWith("@")
    ? key.indexOf("@", key.indexOf("/") + 1)
    : key.indexOf("@");
  if (separator < 0) return undefined;
  return key.slice(0, separator);
}

/** Read pnpm v9 mapping keys from one top-level lockfile section without a new YAML dependency. */
function topLevelMappingKeys(source: string, sectionName: string): string[] {
  const lines = source.split(/\r?\n/);
  const sectionIndex = lines.indexOf(`${sectionName}:`);
  if (sectionIndex < 0)
    throw new Error(`pnpm-lock.yaml has no ${sectionName}: section`);

  const keys: string[] = [];
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("#"))
      break;
    const match = line.match(/^ {2}(.+):\s*$/);
    const key = match?.[1];
    if (key !== undefined) keys.push(unquote(key));
  }
  return keys;
}

function forbiddenResolvedPackages(source: string): string[] {
  return ["packages", "snapshots"].flatMap((section) =>
    topLevelMappingKeys(source, section)
      .map(packageNameFromLockKey)
      .filter(
        (name): name is string =>
          name !== undefined && FORBIDDEN_PACKAGE_NAMES.has(name),
      ),
  );
}

/** Also catch import aliases whose resolved package key alone would obscure the condemned name. */
function forbiddenImporterDependencies(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const importersIndex = lines.indexOf("importers:");
  if (importersIndex < 0)
    throw new Error("pnpm-lock.yaml has no importers: section");

  const found: string[] = [];
  let dependencySection = false;
  let currentDependency: string | undefined;
  let currentIsForbidden = false;
  for (let index = importersIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("#"))
      break;
    const section = line.match(
      /^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/,
    );
    if (section) {
      dependencySection = true;
      currentDependency = undefined;
      currentIsForbidden = false;
      continue;
    }
    if (/^ {4}[^ ]/.test(line)) {
      dependencySection = false;
      currentDependency = undefined;
      continue;
    }
    if (!dependencySection) continue;

    const dependency = line.match(/^ {6}(.+):\s*$/);
    const dependencyName = dependency?.[1];
    if (dependencyName !== undefined) {
      currentDependency = unquote(dependencyName);
      currentIsForbidden = FORBIDDEN_PACKAGE_NAMES.has(currentDependency);
      if (currentIsForbidden) found.push(currentDependency);
      continue;
    }
    if (!currentDependency) continue;
    const specifier = line.match(/^ {8}specifier:\s*(.+?)\s*$/);
    const specifierValue = specifier?.[1];
    if (specifierValue !== undefined) {
      const value = unquote(specifierValue);
      if (/^npm:(?:@octokit\/webhooks|octokit)@/.test(value)) {
        found.push(value);
      }
    }
  }
  return found;
}

describe("fork-time integration removals", () => {
  let routes: Awaited<ReturnType<typeof loadRouterRoutes>> = [];
  let pluginIds: string[] = [];

  beforeAll(async () => {
    routes = await loadRouterRoutes();
    pluginIds = await loadBetterAuthPluginIds();
  }, 120_000);

  it("rejects inherited integration route segments from the constructed Hono router", () => {
    expect(
      routes.length,
      "the real Hono router must be present",
    ).toBeGreaterThan(0);
    const forbidden = routes.filter(({ path }) =>
      hasInheritedIntegrationRoute(path),
    );
    expect(forbidden.map(({ routeKey }) => routeKey)).toEqual([]);
  });

  it("detects known inherited route paths while allowing unrelated lookalike text", () => {
    expect(hasInheritedIntegrationRoute("/api/public-project/:id")).toBe(true);
    expect(
      hasInheritedIntegrationRoute("/api/integrations/github/callback"),
    ).toBe(true);
    expect(hasInheritedIntegrationRoute("/api/projects/:id")).toBe(false);
    expect(hasInheritedIntegrationRoute("/api/webhooks/generic-webhook")).toBe(
      true,
    );
  });

  it("rejects the condemned better-auth plugins on the constructed instance", () => {
    expect(
      pluginIds.length,
      "the constructed better-auth plugin list must be readable",
    ).toBeGreaterThan(0);
    expect(pluginIds.filter((id) => FORBIDDEN_AUTH_PLUGINS.has(id))).toEqual(
      [],
    );
  });

  it("rejects the two exact removed package names from resolved lockfile sections", () => {
    const lockfile = readFileSync(LOCKFILE, "utf8");
    expect(forbiddenResolvedPackages(lockfile)).toEqual([]);
    expect(forbiddenImporterDependencies(lockfile)).toEqual([]);
  });

  it("finds forbidden exact packages and aliases while allowing Octokit family packages", () => {
    const fixture = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      github-hooks:",
      "        specifier: npm:@octokit/webhooks@^3.0.0",
      "        version: 3.0.0",
      "packages:",
      "  octokit@4.1.0:",
      "  '@octokit/webhooks@3.0.0':",
      "  '@octokit/core@7.0.6':",
      "snapshots:",
      "  octokit@4.1.0:",
      "  '@octokit/types@16.0.0':",
    ].join("\n");

    expect(forbiddenImporterDependencies(fixture)).toEqual([
      "npm:@octokit/webhooks@^3.0.0",
    ]);
    expect(forbiddenResolvedPackages(fixture)).toEqual([
      "octokit",
      "@octokit/webhooks",
      "octokit",
    ]);
  });
});

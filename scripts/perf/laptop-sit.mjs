import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const fail = () => {
  throw new Error(
    "Invalid private G11 input; inspect the local input contract without printing its contents.",
  );
};
export function readPrivateJson(filename, root = repositoryRoot) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) fail();
  const stat = lstatSync(filename);
  const resolved = realpathSync(filename);
  const relative = path.relative(realpathSync(root), resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    resolved !== path.resolve(filename) ||
    !relative.startsWith(`..${path.sep}`)
  )
    fail();
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    fail();
  }
}
function localOrigin(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== value ||
      (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.hostname.endsWith(".localhost"))
    )
      fail();
    return value;
  } catch {
    fail();
  }
}
export function validateManifest(input) {
  const validString = (value) =>
    typeof value === "string" && /^[a-zA-Z0-9_@.+-]{1,180}$/.test(value);
  if (
    !input ||
    input.version !== 1 ||
    input.syntheticOnly !== true ||
    !validString(input.runId) ||
    !validString(input.workspaceId) ||
    !validString(input.organisationId) ||
    !validString(input.staffEmail) ||
    typeof input.credentialsFile !== "string"
  )
    fail();
  localOrigin(input.agentOrigin);
  localOrigin(input.portalOrigin);
  if (input.agentOrigin === input.portalOrigin) fail();
  const allIds = new Set();
  for (const [kind, count] of [
    ["list", 500],
    ["board", 200],
  ]) {
    const fixture = input[kind];
    if (
      !fixture ||
      !validString(fixture.projectId) ||
      !validString(fixture.projectKey) ||
      !Array.isArray(fixture.items) ||
      fixture.items.length !== count
    )
      fail();
    const keys = new Set();
    for (const item of fixture.items) {
      if (
        !validString(item.id) ||
        !validString(item.key) ||
        allIds.has(item.id) ||
        keys.has(item.key)
      )
        fail();
      allIds.add(item.id);
      keys.add(item.key);
    }
  }
  if (
    input.list.projectId === input.board.projectId ||
    input.list.projectKey === input.board.projectKey
  )
    fail();
  return input;
}
export function loadManifest(filename) {
  return validateManifest(readPrivateJson(filename));
}

export function main(args) {
  if (args.length !== 2)
    throw new Error(
      "Usage: node scripts/perf/laptop-sit.mjs /absolute/private/manifest.json /absolute/private/output",
    );
  const [inputPath, outputPath] = args;
  loadManifest(inputPath);
  if (
    !path.isAbsolute(outputPath) ||
    !path
      .relative(repositoryRoot, path.resolve(outputPath))
      .startsWith(`..${path.sep}`)
  )
    fail();
  mkdirSync(outputPath, { mode: 0o700 }); // Refuse existing output: never mix runs or overwrite evidence.
  if (realpathSync(outputPath) !== path.resolve(outputPath)) fail();
  const config = path.join(outputPath, "playwright.config.ts");
  const source = path.join(
    repositoryRoot,
    "apps/web/playwright.perf-sit.config.ts",
  );
  writeFileSync(
    config,
    `import { createPersistedPerformanceConfig } from ${JSON.stringify(source)};\nexport default createPersistedPerformanceConfig(${JSON.stringify(inputPath)}, ${JSON.stringify(outputPath)});\n`,
    { mode: 0o600, flag: "wx" },
  );
  const result = spawnSync(
    "pnpm",
    ["exec", "playwright", "test", "--config", config],
    {
      cwd: path.join(repositoryRoot, "apps/web"),
      stdio: "inherit",
    },
  );
  return result.status ?? 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch {
    console.error(
      "G11 runner refused input or could not start. No input contents have been logged.",
    );
    process.exitCode = 1;
  }
}

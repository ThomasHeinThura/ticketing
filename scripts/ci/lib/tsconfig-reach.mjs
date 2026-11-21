/**
 * Which files outside a package does a typecheck config compile, and does turbo see them?
 *
 * The old guard read raw `include` strings that began `../../`. It missed `files`
 * entries, includes inherited through `extends`, and single-parent (`../`) reaches,
 * because it never asked the compiler what the config resolves to. `tsc --showConfig`
 * prints the resolved root file list (include, exclude, files and extends applied), so
 * membership is the compiler's answer. (TypeScript 7 ships no JS compiler API, so the
 * CLI is the only compiler entry point.)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Absolute paths of the config's root files that lie outside `pkgDir`. */
export function outOfPackageFiles(tsc, pkgDir, config) {
  const out = execFileSync(tsc, ["-p", config, "--showConfig"], {
    cwd: pkgDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `tsc -p .` names a directory; tsc resolves files from that directory's tsconfig.json.
  let configPath = path.resolve(pkgDir, config);
  if (fs.statSync(configPath).isDirectory())
    configPath = path.join(configPath, "tsconfig.json");
  const configDir = path.dirname(configPath);
  return (JSON.parse(out).files ?? [])
    .map((file) => path.resolve(configDir, file))
    .filter((file) => path.relative(pkgDir, file).startsWith(".."));
}

/** `{ name, dir }` of the workspace package that owns `file`, or undefined. Stops at `root`. */
function owningPackage(file, root) {
  for (
    let dir = path.dirname(file);
    dir.startsWith(root);
    dir = path.dirname(dir)
  ) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest))
      return { name: JSON.parse(fs.readFileSync(manifest, "utf8")).name, dir };
  }
  return undefined;
}

/** Does `task` hash `rel` (relative to its package)? Default inputs hash every file. */
function taskHashes(task, rel) {
  const inputs = (task.inputs ?? []).map(String);
  const globs = inputs.filter((g) => g !== "$TURBO_DEFAULT$");
  const hit = (list) => list.some((g) => path.matchesGlob(rel, g));
  const wanted =
    inputs.length === 0 || inputs.includes("$TURBO_DEFAULT$")
      ? true
      : hit(globs.filter((g) => !g.startsWith("!")));
  return (
    wanted &&
    !hit(globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1)))
  );
}

/**
 * Out-of-package files compiled by `configs` that neither a typecheck input glob nor an
 * upstream `build`/`typecheck` task of the owning workspace dependency hashes.
 *
 * `inputs`/`dependsOn` are the resolved turbo task; `tasks` is turbo's task map, used to
 * resolve the upstream task's own inputs; `manifest` is the package.json.
 */
export function uncoveredReaches({
  tsc,
  root,
  pkgDir,
  configs,
  inputs,
  dependsOn,
  tasks = {},
  manifest,
}) {
  const globs = inputs.map(String).filter((g) => g !== "$TURBO_DEFAULT$");
  const positive = globs.filter((g) => !g.startsWith("!"));
  const negative = globs
    .filter((g) => g.startsWith("!"))
    .map((g) => g.slice(1));
  const upstream = (dependsOn ?? [])
    .filter((d) => d === "^build" || d === "^typecheck")
    .map((d) => d.slice(1));
  const deps = new Set(
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
  );

  let reaches = 0;
  const problems = [];
  for (const config of configs) {
    for (const file of outOfPackageFiles(tsc, pkgDir, config)) {
      reaches += 1;
      const rel = path.relative(pkgDir, file).split(path.sep).join("/");
      const byInput =
        positive.some((g) => path.matchesGlob(rel, g)) &&
        !negative.some((g) => path.matchesGlob(rel, g));
      const owner = owningPackage(file, root);
      const byDependency =
        owner !== undefined &&
        deps.has(owner.name) &&
        upstream.some((name) =>
          taskHashes(
            tasks[`${owner.name}#${name}`] ?? tasks[name] ?? {},
            path.relative(owner.dir, file).split(path.sep).join("/"),
          ),
        );
      if (!byInput && !byDependency) {
        problems.push(
          `${path.relative(root, path.resolve(pkgDir, config))} compiles ${rel}, which is ` +
            `outside ${path.relative(root, pkgDir)}, but turbo's typecheck inputs for ` +
            `${manifest.name} do not cover it. Default hashing cannot see it, so a cached ` +
            "typecheck can pass over a file it never compiled. Inputs are: " +
            JSON.stringify(inputs),
        );
      }
    }
  }
  return { reaches, problems };
}

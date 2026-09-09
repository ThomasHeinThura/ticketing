#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the shim's source is assembled as text, so `${` in it belongs to the generated file, not this one
/**
 * The projects a package's `typecheck` script really passes to `tsc`.
 *
 * **A4.** L4 bound typecheck coverage to the configs the script names, by matching
 * `-p (\S+)` against the script's TEXT. Text is not an invocation, and it fails in both
 * directions:
 *
 *   --project tsconfig.tests.json          the long form is not matched at all
 *   tsc -b tsconfig.tests.json             build mode names its projects positionally
 *   echo "use -p tsconfig.tests.json" && \
 *     tsc --noEmit -p tsconfig.json        the text claims a config the compiler never
 *                                          opens — a coverage claim about a program that
 *                                          does not exist
 *
 * The first two produce a FALSE FAILURE, which someone would notice. The third produces a
 * false pass, which is the one that matters: `tests/api` could be "covered" by a config
 * mentioned only in an `echo`, and a broken import there would still not fail typecheck.
 * Same shape as F11 and L4 themselves — the claim was wider than the inspection.
 *
 * So the script is EXECUTED, with `tsc` replaced by a recording shim, and the answer is
 * whatever a real compiler would have been handed. `&&`, `;`, `||`, subshells, a wrapper
 * script, an npm-run indirection: all of it resolves, because the shell resolves it rather
 * than a regular expression pretending to.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The shim: an executable named `tsc`, first on PATH, that records argv and exits 0. */
function writeShim(directory, log) {
  const source = [
    "#!/usr/bin/env node",
    'const { appendFileSync } = require("node:fs");',
    `appendFileSync(${JSON.stringify(log)}, ${"`${JSON.stringify(process.argv.slice(2))}\\n`"});`,
    "",
  ].join("\n");
  writeFileSync(path.join(directory, "tsc"), source, { mode: 0o755 });
}

/** Pull the project paths out of one recorded argv. */
export function projectsInArgv(argv) {
  const projects = [];
  let build = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-b" || arg === "--build") {
      build = true;
      continue;
    }
    if (arg === "-p" || arg === "--project") {
      if (argv[i + 1]) projects.push(argv[i + 1]);
      i += 1;
      continue;
    }
    // `tsc -b a.json b.json` takes its projects positionally.
    if (build && !arg.startsWith("-")) projects.push(arg);
  }
  return projects;
}

/**
 * Run `script` in `cwd` with the shim ahead of PATH and return the projects it recorded.
 *
 * Run through `sh -c` rather than the package manager, deliberately: pnpm prepends
 * `node_modules/.bin` to PATH, which would put the real `tsc` ahead of the shim and
 * compile the repository instead of recording it.
 *
 * @returns {string[]} project paths, in first-seen order, deduplicated
 */
export function recordedTscProjects(script, cwd) {
  const shimDir = mkdtempSync(path.join(tmpdir(), "taskdesk-tsc-shim-"));
  const log = path.join(shimDir, "invocations.jsonl");
  try {
    writeShim(shimDir, log);
    try {
      execFileSync("sh", ["-c", script], {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
        env: {
          ...process.env,
          PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
        },
      });
    } catch (error) {
      // A non-tsc command in the script may fail under the shim. What ran, ran; an empty
      // log is the caller's problem to report, not something to pass off as "no projects
      // were needed".
      void error;
    }

    let lines = [];
    try {
      lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }

    const projects = [];
    for (const line of lines) {
      for (const project of projectsInArgv(JSON.parse(line))) {
        if (!projects.includes(project)) projects.push(project);
      }
    }
    return projects;
  } finally {
    rmSync(shimDir, { recursive: true, force: true });
  }
}

/** The PRE-A4 predicate, kept so probes can show what it accepted. */
export function textuallyNamedProjects(script) {
  return [...script.matchAll(/-p\s+(\S+)/g)].map((match) => match[1]);
}

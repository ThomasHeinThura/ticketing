#!/usr/bin/env node
/**
 * The OpenAPI drift check, restored.
 *
 * kaneo had `scripts/openapi/check.mjs`, which regenerated the document and failed when it
 * differed from the committed copy. It wrote `apps/docs/openapi.json`, and `apps/docs` is a
 * *Do not copy* row in docs/04-engineering/repository-bootstrap.md, so neither the script
 * nor its two package.json entries survived the import and the drift check was lost
 * (docs/07-planning/status.md § Blocked). This restores it against a TaskDesk destination.
 *
 * **Destination, and why it is not the one api-design.md names.**
 * docs/01-architecture/api-design.md § Documentation says the spec is "exported in CI to
 * `apps/site/public/openapi.json` so the documentation website renders the same reference",
 * and docs/08-docs-site/plan.md § The API reference draws the same pipeline. That is the
 * *published* copy, and this repository's own .gitignore lists that exact path under
 * "Generated at build/release time, not source" — so it cannot also be the committed
 * baseline a drift check compares against.
 *
 * The baseline therefore lives in `tests/api-contract/`, which is where
 * docs/04-engineering/testing-strategy.md § API contract tests puts the contract layer, and
 * is exactly the document `pnpm test:contract` needs: Redocly lints it, and `oasdiff
 * breaking` diffs the pull request's spec against main's. Publishing the same document to
 * apps/site/public/ is a separate step that arrives with apps/site, whose stack is still an
 * open decision in docs/07-planning/status.md.
 *
 * Usage:
 *   node scripts/ci/check-openapi.mjs           regenerate and compare — fails on drift
 *   node scripts/ci/check-openapi.mjs --write    update the committed document
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exists, finish, readText, repoRoot, violation } from "./lib/repo.mjs";

const NAME = "check:openapi";

/** The committed contract baseline. */
export const documentPath = path.join(
  repoRoot,
  "tests/api-contract/openapi.json",
);

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

function operationsOf(document) {
  const operations = new Set();
  for (const [route, methods] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(methods ?? {})) {
      operations.add(`${method.toUpperCase()} ${route}`);
    }
  }
  return operations;
}

function summarise(before, after) {
  const lines = [];
  const previous = operationsOf(before);
  const next = operationsOf(after);

  const added = [...next]
    .filter((operation) => !previous.has(operation))
    .sort();
  const removed = [...previous]
    .filter((operation) => !next.has(operation))
    .sort();

  for (const operation of added) {
    lines.push(`+ ${operation}`);
  }
  for (const operation of removed) {
    lines.push(`- ${operation}`);
  }
  if (lines.length === 0) {
    lines.push(
      "(no route added or removed — a schema, parameter or description changed)",
    );
  }
  return lines;
}

async function main() {
  const write = process.argv.includes("--write");
  const temporary = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "taskdesk-openapi-")),
    "openapi.json",
  );

  run("pnpm", ["--filter", "@taskdesk/api^...", "build"]);
  run("pnpm", ["--filter", "@taskdesk/api", "openapi:export", temporary]);

  const generated = await readText(temporary);

  if (write || !(await exists(documentPath))) {
    await fs.mkdir(path.dirname(documentPath), { recursive: true });
    await fs.writeFile(documentPath, generated);
    process.stdout.write(
      `${NAME}: wrote ${path.relative(repoRoot, documentPath)} (${generated.length} bytes)\n`,
    );
    if (!write) {
      process.stderr.write(
        `\n${NAME}: the committed document did not exist and has been created. Commit it.\n\n`,
      );
      process.exitCode = 1;
    }
    return;
  }

  const committed = await readText(documentPath);
  if (committed === generated) {
    finish({
      name: NAME,
      failures: [],
      ok: `tests/api-contract/openapi.json matches the API (${operationsOf(JSON.parse(committed)).size} operations)`,
    });
    return;
  }

  const detail = summarise(JSON.parse(committed), JSON.parse(generated)).join(
    "\n      ",
  );
  finish({
    name: NAME,
    failures: [
      violation(
        "tests/api-contract/openapi.json",
        "the committed OpenAPI document no longer matches the API the code serves. If the change " +
          "is intended, run `pnpm openapi:write` and commit the result so the diff is reviewable; " +
          "a breaking change also needs the version treatment in " +
          "docs/01-architecture/api-design.md § Versioning.\n      " +
          detail,
      ),
    ],
  });
}

await main();

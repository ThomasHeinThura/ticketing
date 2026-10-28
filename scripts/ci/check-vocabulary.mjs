#!/usr/bin/env node
/**
 * check:vocabulary — workspace table declarations must be in the maintained schema contract.
 * Capabilities/roles/elevated routes and complete feature defaults have exact permission
 * contract tests; the dedicated vocabulary tests also inspect scheduler job registration.
 *
 * Tables: docs/technical/data-model.md
 * Permissions: docs/technical/permissions.md
 * Features/plugins: docs/technical/features.md
 * Events: docs/technical/events.md
 * Jobs: docs/technical/background-jobs.md
 *
 * Inherited table names retain the existing shrink-only, history-bound baseline.
 * Usage: node scripts/ci/check-vocabulary.mjs [--prune]
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  addedKeys,
  addedWithinKeys,
  BaselineHistoryUnavailableError,
  readBaselineAtMergeBase,
} from "./lib/git-baseline.mjs";
import {
  codeFilesUnder,
  finish,
  readText,
  rel,
  repoRoot,
  violation,
} from "./lib/repo.mjs";

import { readWorkspaceRoots } from "./lib/workspace-membership.mjs";

const NAME = "check:vocabulary";

const BASELINE_RELATIVE_PATH = "scripts/ci/vocabulary-baseline.json";
const RATCHET_SECTIONS = [["unregistered", "an unregistered identifier"]];
const baselinePath = path.join(repoRoot, "scripts/ci/vocabulary-baseline.json");

// A5's class: `roots` was the literal `["apps", "packages"]`. It is the workspace's
// membership rule, so it is read from the workspace definition — adding `tools/**` to
// pnpm-workspace.yaml must not leave a declared table in there unregistered and unnoticed.
// Derived at run time rather than at module load, because a failure to read the workspace
// has to reach `main()`'s error handling instead of throwing at import.
const classes = [
  {
    identifier: "table",
    authority: "docs/technical/data-model.md",
    roots: null, // the workspace roots; resolved in main()
    declaration: /pgTable\(\s*["']([^"']+)["']/g,
  },
];

/** Every backticked snake_case identifier the authority document names. */
async function registered(authority) {
  const source = await readText(path.join(repoRoot, authority));
  const names = new Set();
  for (const match of source.matchAll(/`([a-z][a-z0-9_]{2,})`/g)) {
    names.add(match[1]);
  }
  if (names.size === 0) {
    throw new Error(
      `No identifiers parsed from ${authority}; refusing to run.`,
    );
  }
  return names;
}

async function loadBaseline() {
  try {
    return JSON.parse(await readText(baselinePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { unregistered: {} };
    }
    throw error;
  }
}

async function main() {
  const prune = process.argv.includes("--prune");
  const baseline = await loadBaseline();
  const failures = [];
  const warnings = [];
  const observed = {};
  let declaredCount = 0;

  for (const group of classes) {
    const approved = await registered(group.authority);
    const found = new Map();

    for (const absolute of await codeFilesUnder(
      group.roots ?? (await readWorkspaceRoots()),
    )) {
      const source = await readText(absolute);
      group.declaration.lastIndex = 0;
      for (
        let match = group.declaration.exec(source);
        match !== null;
        match = group.declaration.exec(source)
      ) {
        declaredCount += 1;
        const name = match[1];
        if (approved.has(name)) {
          continue;
        }
        const locations = found.get(name) ?? new Set();
        locations.add(rel(absolute));
        found.set(name, locations);
      }
    }

    const key = group.identifier;
    observed[key] = {};
    for (const name of [...found.keys()].sort()) {
      observed[key][name] = [...found.get(name)].sort();
    }

    const baselined = baseline.unregistered?.[key] ?? {};
    for (const [name, locations] of Object.entries(observed[key])) {
      if (name in baselined) {
        continue;
      }
      failures.push(
        violation(
          locations.join(", "),
          `${group.identifier} \`${name}\` is not named in ${group.authority}. ` +
            "Update the maintained contract in the same change.",
        ),
      );
    }

    const stale = Object.keys(baselined).filter(
      (name) => !(name in observed[key]),
    );
    if (stale.length > 0) {
      warnings.push(
        `${stale.length} baselined ${group.identifier} name(s) no longer declared — run \`pnpm check:vocabulary --prune\`.`,
      );
    }
  }

  // ── F3: the shrink-only ratchet, compared against history ───────────────────
  // Documented as only ever shrinking, but nothing compared it against its own past.
  // A new `pgTable("rev19_probe_growth")` plus one hand-added baseline entry in the
  // same diff went green while printing "13 inherited identifier(s) … This number must
  // only fall" — up from 12. Reproduced before this fix. The baseline's content at the
  // merge base is the only reference the current change cannot rewrite.
  try {
    const { base, previous } = readBaselineAtMergeBase(BASELINE_RELATIVE_PATH);
    if (previous) {
      for (const [section, label] of RATCHET_SECTIONS) {
        const now = baseline[section] ?? {};
        const before = previous[section] ?? {};
        // `unregistered` nests one level: kind -> name -> locations.
        for (const kind of new Set([
          ...Object.keys(now),
          ...Object.keys(before),
        ])) {
          for (const key of addedKeys(now[kind], before[kind])) {
            failures.push(
              violation(
                `${BASELINE_RELATIVE_PATH} (${section}.${kind})`,
                `\`${key}\` was ADDED to the baseline relative to the merge base ` +
                  `${base.sha.slice(0, 9)} (${base.ref}). This list only ever shrinks: ` +
                  `${label} is inherited debt, and appending to it is how a new ` +
                  "violation ships green. Name the identifier in its authority document " +
                  "instead.",
              ),
            );
          }
          for (const { key, added } of addedWithinKeys(
            now[kind],
            before[kind],
          )) {
            failures.push(
              violation(
                `${BASELINE_RELATIVE_PATH} (${section}.${kind}.${key})`,
                `${added.length} new location(s) under \`${key}\` relative to the ` +
                  `merge base — ${added.join(", ")}. Growth inside an existing key is ` +
                  "still growth.",
              ),
            );
          }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    failures.push(violation(BASELINE_RELATIVE_PATH, error.message));
  }

  if (prune) {
    const unregistered = {};
    for (const [key, names] of Object.entries(observed)) {
      unregistered[key] = {};
      for (const name of Object.keys(
        baseline.unregistered?.[key] ?? {},
      ).sort()) {
        if (name in names) {
          unregistered[key][name] = names[name];
        }
      }
    }
    await fs.writeFile(
      baselinePath,
      `${JSON.stringify({ ...baseline, unregistered }, null, "\t")}\n`,
    );
    process.stdout.write(`${NAME}: baseline pruned\n`);
    return;
  }

  const debt = Object.values(baseline.unregistered ?? {}).reduce(
    (total, names) => total + Object.keys(names).length,
    0,
  );
  if (debt > 0) {
    warnings.push(
      `${debt} inherited identifier(s) still baselined in scripts/ci/vocabulary-baseline.json. This number must only fall.`,
    );
  }
  warnings.push(
    "table registration checked here; permission, feature, event and scheduler contracts have dedicated checks.",
  );

  finish({
    name: NAME,
    failures,
    warnings,
    ok: `${declaredCount} table declaration(s), every one registered in its authority document`,
  });
}

await main();

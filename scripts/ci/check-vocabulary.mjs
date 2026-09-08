#!/usr/bin/env node
/**
 * check:vocabulary — every identifier is registered in its authority document.
 *
 * AGENTS.md do-not 11: never name a table, column, capability, feature flag, event key or
 * job that is not in its single authoritative document. CLAUDE.md restates the mapping:
 *
 *   Tables and columns          docs/01-architecture/data-model.md
 *   Capabilities, policy kinds  docs/01-architecture/rbac.md
 *   Feature flags, plugin kinds docs/01-architecture/plugin-architecture.md
 *   Event keys                  docs/01-architecture/events.md
 *   Background jobs             docs/01-architecture/background-jobs.md
 *
 * **Today this checks tables only**, because a table is the one identifier class the
 * repository actually declares in code right now: `pgTable("name", …)`. Capabilities live
 * in packages/permissions (#7), event keys and job names in code that does not exist yet.
 * Each becomes a `classes` entry below the moment its declaration site lands — nothing
 * else about this script changes. Reporting that honestly is deliberate: a gate that scans
 * for identifiers no file declares would pass vacuously and look like coverage.
 *
 * Like check:env, this is a ratchet over the inherited kaneo names. See
 * scripts/ci/vocabulary-baseline.json.
 *
 * Usage:
 *   node scripts/ci/check-vocabulary.mjs
 *   node scripts/ci/check-vocabulary.mjs --prune
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

const NAME = "check:vocabulary";

const BASELINE_RELATIVE_PATH = "scripts/ci/vocabulary-baseline.json";
const RATCHET_SECTIONS = [["unregistered", "an unregistered identifier"]];
const baselinePath = path.join(repoRoot, "scripts/ci/vocabulary-baseline.json");

const classes = [
  {
    identifier: "table",
    authority: "docs/01-architecture/data-model.md",
    roots: ["apps", "packages"],
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

    for (const absolute of await codeFilesUnder(group.roots)) {
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
            "Add it there first, in the same change (AGENTS.md do-not 11).",
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
                  "instead (AGENTS.md do-not 11).",
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
    "tables only — capabilities, feature flags, event keys and background jobs are added to `classes` as soon as the code that declares them exists.",
  );

  finish({
    name: NAME,
    failures,
    warnings,
    ok: `${declaredCount} table declaration(s), every one registered in its authority document`,
  });
}

await main();

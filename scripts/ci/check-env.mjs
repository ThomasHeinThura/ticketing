#!/usr/bin/env node
/**
 * check:env — every environment read is attributable to an approved entry in
 * docs/05-operations/configuration-reference.md.
 *
 * AGENTS.md rule 2: environment variables are for bootstrap only, five required and a
 * handful of optional operational switches, "all listed in configuration-reference.md and
 * nowhere else — check:env fails the build on any other process.env read."
 *
 * This is not a grep. See lib/env-reads.mjs for what it detects and why a grep is not
 * enough. Three outcomes per environment access:
 *
 *   approved        — a literal name that configuration-reference.md lists for this surface
 *   unapproved      — a literal name it does not list
 *   unattributable  — the name cannot be resolved at all: process.env[name], a lookup
 *                     table, or an alias such as `env: SmtpEnv = process.env`
 *
 * Unattributable reads fail. They are the shape the kaneo import hid eighty variables
 * behind, and no allow-list can cover a name that is computed at runtime.
 *
 * The inherited kaneo surface has not finished its migration to the five-plus-six rule
 * (docs/04-engineering/repository-bootstrap.md § 2), so env-baseline.json records the debt
 * that exists today. The baseline is a ratchet: an unapproved read that is not already in
 * it fails the build. Entries may be removed and never added by hand — regenerate with
 * `pnpm check:env --prune` after deleting code, never to make a new violation pass.
 *
 * Usage:
 *   node scripts/ci/check-env.mjs            verify
 *   node scripts/ci/check-env.mjs --prune    drop baseline entries that no longer apply
 *   node scripts/ci/check-env.mjs --report   list every read, grouped, and exit 0
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readConfigurationReference } from "./lib/configuration-reference.mjs";
import { findEnvReads, viteBuiltIns } from "./lib/env-reads.mjs";
import {
  codeFilesUnder,
  finish,
  readText,
  rel,
  repoRoot,
  violation,
} from "./lib/repo.mjs";

const NAME = "check:env";
const baselinePath = path.join(repoRoot, "scripts/ci/env-baseline.json");

/**
 * Surfaces scanned, and what each is allowed to read. Tests and build tooling are not the
 * application; the note printed at the end says so out loud rather than leaving the gap
 * silent.
 */
const scanRoots = ["apps", "packages"];
const mcpPackage = "packages/mcp/";

function scopeOf(file) {
  return file.startsWith(mcpPackage) ? "mcp" : "application";
}

async function loadBaseline() {
  try {
    return JSON.parse(await readText(baselinePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { unmigratedNames: {}, unattributableReads: {} };
    }
    throw error;
  }
}

async function main() {
  const mode = process.argv.includes("--prune")
    ? "prune"
    : process.argv.includes("--report")
      ? "report"
      : "verify";

  const reference = await readConfigurationReference();
  const baseline = await loadBaseline();

  const applicationApproved = new Set([
    ...reference.required,
    ...reference.optional,
  ]);
  const mcpApproved = new Set(
    [...reference.notReadByApplication.entries()]
      .filter(([, readBy]) => readBy.includes("@taskdesk/mcp"))
      .map(([name]) => name),
  );

  const files = await codeFilesUnder(scanRoots);
  const failures = [];
  const warnings = [];
  const observedNames = new Map();
  const observedUnattributable = new Map();
  const approvedReads = [];

  for (const absolute of files) {
    const file = rel(absolute);
    const scope = scopeOf(file);
    const approved = scope === "mcp" ? mcpApproved : applicationApproved;
    const reads = findEnvReads(await readText(absolute));

    for (const read of reads) {
      const location = `${file}:${read.line}`;

      if (read.kind !== "named") {
        const list = observedUnattributable.get(file) ?? [];
        list.push(read);
        observedUnattributable.set(file, list);
        continue;
      }

      if (read.object === "import.meta.env" && viteBuiltIns.has(read.name)) {
        continue;
      }

      if (approved.has(read.name)) {
        approvedReads.push(`${location} ${read.name}`);
        continue;
      }

      const list = observedNames.get(read.name) ?? [];
      list.push(location);
      observedNames.set(read.name, list);
    }
  }

  if (mode === "report") {
    process.stdout.write(`${NAME}: ${approvedReads.length} approved read(s)\n`);
    for (const line of approvedReads) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write(
      `\n${NAME}: ${observedNames.size} unapproved name(s)\n`,
    );
    for (const [name, locations] of [...observedNames].sort()) {
      process.stdout.write(`  ${name}\n    ${locations.join("\n    ")}\n`);
    }
    process.stdout.write(
      `\n${NAME}: ${observedUnattributable.size} file(s) with unattributable reads\n`,
    );
    for (const [file, reads] of [...observedUnattributable].sort()) {
      process.stdout.write(`  ${file}\n`);
      for (const read of reads) {
        process.stdout.write(
          `    ${read.line} ${read.kind}: ${read.snippet}\n`,
        );
      }
    }
    return;
  }

  if (mode === "prune") {
    const unmigratedNames = {};
    for (const name of Object.keys(baseline.unmigratedNames ?? {}).sort()) {
      if (observedNames.has(name)) {
        unmigratedNames[name] = observedNames.get(name);
      }
    }
    const unattributableReads = {};
    for (const file of Object.keys(baseline.unattributableReads ?? {}).sort()) {
      if (observedUnattributable.has(file)) {
        unattributableReads[file] = baseline.unattributableReads[file];
      }
    }
    const next = { ...baseline, unmigratedNames, unattributableReads };
    await fs.writeFile(baselinePath, `${JSON.stringify(next, null, "\t")}\n`);
    process.stdout.write(
      `${NAME}: baseline pruned — ${Object.keys(unmigratedNames).length} name(s), ` +
        `${Object.keys(unattributableReads).length} file(s) remain\n`,
    );
    return;
  }

  for (const [name, locations] of [...observedNames].sort()) {
    if (name in (baseline.unmigratedNames ?? {})) {
      continue;
    }
    const compose = reference.notReadByApplication.get(name);
    const why = compose
      ? `\`${name}\` is listed in configuration-reference.md as NOT read by the application (${compose}). Application code must not read it.`
      : `\`${name}\` is not in docs/05-operations/configuration-reference.md. Add it there first, in the same change, or use runtime configuration (God Mode) instead — see AGENTS.md rule 2.`;
    failures.push(violation(locations.join("\n  "), why));
  }

  for (const [file, reads] of [...observedUnattributable].sort()) {
    if (file in (baseline.unattributableReads ?? {})) {
      continue;
    }
    const detail = reads
      .map((read) => `line ${read.line} (${read.kind}): ${read.snippet}`)
      .join("\n      ");
    failures.push(
      violation(
        file,
        "unattributable environment read — the variable name cannot be resolved to a " +
          "string literal, so it cannot be checked against configuration-reference.md. " +
          `Read a literal name, or route the read through a central configuration module.\n      ${detail}`,
      ),
    );
  }

  const staleNames = Object.keys(baseline.unmigratedNames ?? {}).filter(
    (name) => !observedNames.has(name),
  );
  const staleFiles = Object.keys(baseline.unattributableReads ?? {}).filter(
    (file) => !observedUnattributable.has(file),
  );
  if (staleNames.length > 0 || staleFiles.length > 0) {
    warnings.push(
      `${staleNames.length} baseline name(s) and ${staleFiles.length} baseline file(s) are ` +
        "no longer read — run `pnpm check:env --prune` to shrink the ratchet.",
    );
  }

  const debt =
    Object.keys(baseline.unmigratedNames ?? {}).length +
    Object.keys(baseline.unattributableReads ?? {}).length;
  if (debt > 0) {
    warnings.push(
      `${debt} inherited environment-read deviation(s) still baselined in scripts/ci/env-baseline.json ` +
        "(docs/04-engineering/repository-bootstrap.md § 2 migration is unfinished). This number must only fall.",
    );
  }

  warnings.push(
    `scanned ${files.length} file(s) under ${scanRoots.join(", ")}; tests/ and scripts/ are build tooling, not the application, and are not scanned.`,
  );

  finish({
    name: NAME,
    failures,
    warnings,
    ok: `${approvedReads.length} environment read(s), every one attributable to configuration-reference.md`,
  });
}

await main();

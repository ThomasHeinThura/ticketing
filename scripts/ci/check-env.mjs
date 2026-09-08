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

const NAME = "check:env";

const BASELINE_RELATIVE_PATH = "scripts/ci/env-baseline.json";
/** Baseline sections the ratchet guards, with a human label for the message. */
const RATCHET_SECTIONS = [
  ["unmigratedNames", "an unregistered environment name"],
  ["unattributableReads", "an unattributable environment read"],
];
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
      if (!observedUnattributable.has(file)) continue;
      // F10: record HOW MANY reads the file was baselined with. A bare reason string
      // blanket-exempted the file, so a new computed read added beside the inherited
      // one passed silently — in two files that handle S3 and SMTP credentials.
      const existing = baseline.unattributableReads[file];
      const reason =
        typeof existing === "object" && existing !== null
          ? existing.reason
          : existing;
      unattributableReads[file] = {
        reason,
        reads: observedUnattributable.get(file).length,
      };
    }
    const next = { ...baseline, unmigratedNames, unattributableReads };
    await fs.writeFile(baselinePath, `${JSON.stringify(next, null, "\t")}\n`);
    process.stdout.write(
      `${NAME}: baseline pruned — ${Object.keys(unmigratedNames).length} name(s), ` +
        `${Object.keys(unattributableReads).length} file(s) remain\n`,
    );
    return;
  }

  // F10: a baselined NAME is exempt only in the FILES the baseline records it in, not
  // repo-wide. `COOKIE_DOMAIN` inherited at apps/api/src/auth.ts does not license a
  // second read of it somewhere else.
  const exemptFilesByName = new Map(
    Object.entries(baseline.unmigratedNames ?? {}).map(([name, locations]) => [
      name,
      new Set(
        (Array.isArray(locations) ? locations : []).map(
          (location) => String(location).split(":")[0],
        ),
      ),
    ]),
  );

  for (const [name, locations] of [...observedNames].sort()) {
    const exemptFiles = exemptFilesByName.get(name);
    if (exemptFiles) {
      const unexpected = locations.filter(
        (location) => !exemptFiles.has(String(location).split(":")[0]),
      );
      if (unexpected.length === 0) continue;
      failures.push(
        violation(
          unexpected.join("\n  "),
          `\`${name}\` is baselined as inherited debt, but only in ` +
            `${[...exemptFiles].join(", ")}. A baselined name is NOT exempt repo-wide — ` +
            "a new read of it elsewhere is new debt. Add it to " +
            "docs/05-operations/configuration-reference.md, or use runtime configuration.",
        ),
      );
      continue;
    }
    const compose = reference.notReadByApplication.get(name);
    const why = compose
      ? `\`${name}\` is listed in configuration-reference.md as NOT read by the application (${compose}). Application code must not read it.`
      : `\`${name}\` is not in docs/05-operations/configuration-reference.md. Add it there first, in the same change, or use runtime configuration (God Mode) instead — see AGENTS.md rule 2.`;
    failures.push(violation(locations.join("\n  "), why));
  }

  // F10: a baselined FILE was blanket-exempt, so any NEW computed read added to
  // apps/api/src/storage/s3.ts or packages/email/src/smtp-config.ts — both of which
  // handle credentials — passed silently. The baseline now records how many reads it
  // was seeded with per file, and a file that grows past its recorded count fails.
  const allowedCounts = new Map(
    Object.entries(baseline.unattributableReads ?? {}).map(([file, value]) => [
      file,
      typeof value === "object" && value !== null && "reads" in value
        ? Number(value.reads)
        : Number.POSITIVE_INFINITY,
    ]),
  );

  for (const [file, reads] of [...observedUnattributable].sort()) {
    if (allowedCounts.has(file)) {
      const allowed = allowedCounts.get(file);
      if (reads.length <= allowed) continue;
      const detail = reads
        .map((read) => `line ${read.line} (${read.kind}): ${read.snippet}`)
        .join("\n      ");
      failures.push(
        violation(
          file,
          `${reads.length} unattributable environment read(s), but the baseline records ` +
            `${allowed}. This file carries INHERITED debt; it is not a licence to add ` +
            "more. Read a literal name, or route the read through a central configuration " +
            `module.\n      ${detail}`,
        ),
      );
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

  // ── F3: the shrink-only ratchet, compared against history ───────────────────
  // This baseline is documented as only ever shrinking, but nothing compared it
  // against its own past, so it was not a ratchet. A change that added a violation AND
  // appended the matching baseline line moved both sides of the comparison together and
  // went green while printing a number the file says must only fall. Reproduced before
  // this fix. The only thing that catches it is the baseline's content at the merge
  // base, which the current change cannot rewrite. Same helper semantics as
  // tests/permissions/git-baseline.ts, including its refusal to guess.
  try {
    const { base, previous } = readBaselineAtMergeBase(BASELINE_RELATIVE_PATH);
    if (previous) {
      for (const [section, label] of RATCHET_SECTIONS) {
        for (const key of addedKeys(baseline[section], previous[section])) {
          failures.push(
            violation(
              `${BASELINE_RELATIVE_PATH} (${section})`,
              `\`${key}\` was ADDED to the baseline relative to the merge base ` +
                `${base.sha.slice(0, 9)} (${base.ref}). This list only ever shrinks: ` +
                `${label} is inherited debt, and appending to it is how a new violation ` +
                "ships green. Fix the violation, or take the change to Thomas as a " +
                "deliberate, recorded exception.",
            ),
          );
        }
        for (const { key, added } of addedWithinKeys(
          baseline[section],
          previous[section],
        )) {
          failures.push(
            violation(
              `${BASELINE_RELATIVE_PATH} (${section}.${key})`,
              `${added.length} new entr(y/ies) under \`${key}\` relative to the merge ` +
                `base — ${added.join(", ")}. Growth inside an existing key is still ` +
                "growth.",
            ),
          );
        }
      }
    }
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    failures.push(violation(BASELINE_RELATIVE_PATH, error.message));
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

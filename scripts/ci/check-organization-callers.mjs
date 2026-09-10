#!/usr/bin/env node
/**
 * check:organization-callers — the S10 zero-live-caller tripwire.
 *
 * S10 (docs/07-planning/retrofits/organization-plugin-retrofit.md) unmounts better-auth's
 * `organization()` plugin, and it may only run once **zero executable
 * `authClient.organization.*` callers remain** in the client runtime surface
 * (`apps/web/src`). This gate is the mechanical proof of that count, not a grep: see
 * `scripts/ci/lib/organization-callers.mjs` for what it detects and why a grep has already
 * miscounted this exact surface five times on this project (comments that NAME the method
 * a retrofit already replaced, e.g. `// S4b: native replacement for
 * authClient.organization.create().`, which `grep -c` happily counts).
 *
 * **This is a reporting gate today, not a zero-tolerance one.** There are real, live call
 * sites left — the retrofit is mid-flight — and this gate must stay GREEN with them
 * present. What it enforces instead is monotonicity: `scripts/ci/organization-callers-
 * baseline.json` is a **shrink-only ratchet**, the same mechanism `check:env` and
 * `check:vocabulary` already use for exactly this shape of inherited debt (see
 * `lib/git-baseline.mjs`'s header for why a baseline must compare itself against its
 * content AT THE MERGE BASE, not against its own current content, or a diff that adds a
 * violation and its own baseline line in the same change goes green).
 *
 *   - a call site the scanner observes that is NOT in the baseline           -> FAIL
 *     (this is "the count rose", the literal thing S10 needs never to happen unnoticed)
 *   - the baseline itself grew relative to the merge base with main          -> FAIL
 *     (closes the same-diff bypass: adding a caller AND a matching baseline line together)
 *   - a baselined call site no longer observed                              -> shrink,
 *     reported as a note; run `--prune` to drop it from the baseline
 *   - any occurrence the scanner's grammar cannot classify as a clean call    -> FAIL,
 *     unconditionally, independent of the ratchet — see lib/organization-callers.mjs's
 *     header for the exhaustive list of refused shapes. This is the fail-closed half of
 *     the gate: it never reports zero because it could not understand a file, it refuses.
 *
 * **How this flips to a hard fail-closed gate at zero, with no code change here.** The
 * ratchet already IS zero-tolerance for anything not baselined. Once a lane removes the
 * last call site, running `--prune` writes `"callers": {}`. From that commit on, the
 * baseline has nothing left to license: the very first new `authClient.organization.*`
 * call introduced afterwards is "observed, not baselined" and fails on its own, with no
 * `--require-zero` flag or second gate ever needed. The day this file's `callers` object
 * is `{}` IS the day S10's precondition is mechanically provable, continuously, for free.
 *
 * Usage:
 *   node scripts/ci/check-organization-callers.mjs            verify
 *   node scripts/ci/check-organization-callers.mjs --prune    drop entries no longer observed
 *   node scripts/ci/check-organization-callers.mjs --report   list every call site, exit 0
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  addedKeys,
  addedWithinKeys,
  BaselineHistoryUnavailableError,
  normaliseSection,
  readBaselineAtMergeBase,
} from "./lib/git-baseline.mjs";
import {
  findAuthClientDefinition,
  loadPathAliases,
  OrganizationCallerScanUnavailableError,
  scanFiles,
} from "./lib/organization-callers.mjs";
import {
  codeFilesUnder,
  finish,
  readText,
  rel,
  repoRoot,
  violation,
} from "./lib/repo.mjs";
import { stripCodeComments } from "./lib/strip-code-comments.mjs";

const NAME = "check:organization-callers";
const SCAN_ROOT = "apps/web/src";
const TSCONFIG_RELATIVE = "apps/web/tsconfig.json";
const BASELINE_RELATIVE_PATH = "scripts/ci/organization-callers-baseline.json";
const baselinePath = path.join(repoRoot, BASELINE_RELATIVE_PATH);

async function loadBaseline() {
  try {
    return JSON.parse(await readText(baselinePath));
  } catch (error) {
    if (error.code === "ENOENT") return { callers: {} };
    throw error;
  }
}

/** A stable per-file identity for one call: the family plus its (whitespace-collapsed)
 * source line, indexed among duplicates — the same fingerprint discipline env-reads.mjs
 * uses (GPT-F3): NOT the line number, so an unrelated edit above a baselined call does not
 * register as new debt, and NOT a bare count, so a swap is visible even when the total
 * does not change. */
function fingerprints(calls) {
  const seen = new Map();
  return calls.map((call) => {
    const body = `${call.family}: ${call.snippet}`;
    const index = (seen.get(body) ?? 0) + 1;
    seen.set(body, index);
    return `${call.family} #${index}: ${call.snippet}`;
  });
}

async function locateDefinition(files) {
  const candidates = [];
  for (const absolute of files) {
    const source = await readText(absolute);
    if (!source.includes("createAuthClient")) continue;
    candidates.push({ absolute, source: stripCodeComments(source) });
  }
  return findAuthClientDefinition(candidates);
}

async function main() {
  const mode = process.argv.includes("--prune")
    ? "prune"
    : process.argv.includes("--report")
      ? "report"
      : "verify";

  const files = await codeFilesUnder([SCAN_ROOT]);
  const failures = [];
  const warnings = [];

  let definition;
  try {
    definition = await locateDefinition(files);
  } catch (error) {
    if (!(error instanceof OrganizationCallerScanUnavailableError)) throw error;
    finish({ name: NAME, failures: [violation(SCAN_ROOT, error.message)] });
    return;
  }

  const aliasRules = await loadPathAliases(
    path.join(repoRoot, TSCONFIG_RELATIVE),
  );

  const results = await scanFiles({
    definitionAbsolutePath: definition.file,
    exportName: definition.exportName,
    aliasRules,
    files,
    readFile: readText,
  });

  // ── Refusals are unconditional, and checked BEFORE the ratchet ever runs ─────────────
  // A shape this scanner cannot classify is never absorbed into "debt"; it is a defect in
  // the scanner's own coverage, or a shape sneaky enough to deserve a human look either
  // way. "31 live callers, 0 refusals" is this gate's own proof that it is not vacuous
  // over apps/web/src today — see the pull request for the reconciliation against the
  // manual count.
  const refusalFailures = [];
  for (const result of results) {
    for (const refusal of result.refusals) {
      refusalFailures.push(
        violation(
          `${rel(result.file)}:${refusal.line}`,
          `cannot classify this use of the auth client — ${refusal.reason}\n      ${refusal.snippet}`,
        ),
      );
    }
  }
  if (refusalFailures.length > 0) {
    finish({
      name: NAME,
      failures: [
        ...refusalFailures,
        violation(
          "(scanner)",
          "the shapes above defeated the mechanical scanner in lib/organization-callers.mjs. " +
            "This gate fails closed rather than silently reporting a caller count that may be " +
            "wrong — read the shape, and either it is a new organization() call (fix it) or " +
            "the scanner's grammar needs to learn it (extend lib/organization-callers.mjs, " +
            "narrowly, with a test proving the new shape).",
        ),
      ],
    });
    return;
  }

  const baseline = await loadBaseline();
  const observed = new Map(); // file -> fingerprint[]
  let totalCalls = 0;
  const families = new Set();
  for (const result of results) {
    if (result.calls.length === 0) continue;
    const file = rel(result.file);
    observed.set(file, fingerprints(result.calls));
    totalCalls += result.calls.length;
    for (const call of result.calls) families.add(call.family);
  }

  if (mode === "report") {
    process.stdout.write(
      `${NAME}: ${totalCalls} live call site(s) across ${families.size} famil${families.size === 1 ? "y" : "ies"}\n`,
    );
    for (const [file, fps] of [...observed].sort()) {
      process.stdout.write(`  ${file}\n`);
      for (const fp of fps) process.stdout.write(`    ${fp}\n`);
    }
    return;
  }

  if (mode === "prune") {
    const callers = {};
    for (const file of Object.keys(baseline.callers ?? {}).sort()) {
      if (!observed.has(file)) continue;
      const existing = baseline.callers[file];
      const reason =
        typeof existing === "object" && existing !== null
          ? existing.reason
          : "inherited: S10 (organization() unmount) has not landed for this call site yet.";
      callers[file] = { reason, occurrences: observed.get(file) };
    }
    // A file observed for the first time (never baselined) is NOT written here — pruning
    // only ever removes what verify would otherwise call stale, it never adds new debt.
    // `verify` is what tells you a new file needs a baseline entry, deliberately, because
    // writing one silently is exactly the same-diff bypass F3 closed for check:env.
    await fs.writeFile(
      baselinePath,
      `${JSON.stringify({ ...baseline, callers }, null, "\t")}\n`,
    );
    process.stdout.write(
      `${NAME}: baseline pruned — ${Object.keys(callers).length} file(s) remain\n`,
    );
    return;
  }

  // ── verify: observed vs. baselined, file by file ────────────────────────────────────
  const baselineOccurrences = new Map(
    Object.entries(baseline.callers ?? {}).map(([file, value]) => [
      file,
      typeof value === "object" &&
      value !== null &&
      Array.isArray(value.occurrences)
        ? value.occurrences.map(String)
        : null,
    ]),
  );

  for (const [file, fps] of [...observed].sort()) {
    const allowed = baselineOccurrences.get(file);
    if (allowed === undefined) {
      failures.push(
        violation(
          file,
          `${fps.length} live \`authClient.organization.*\` call site(s) here are not in ` +
            `${BASELINE_RELATIVE_PATH}. This is a SHRINK-ONLY ratchet: a file with no ` +
            "entry has no licence to call the organization() plugin. If this is genuinely " +
            "inherited debt being moved rather than new debt being added, run " +
            "`pnpm check:organization-callers --prune` after confirming the merge-base " +
            "comparison below agrees it is not new." +
            `\n      ${fps.join("\n      ")}`,
        ),
      );
      continue;
    }
    if (allowed === null) {
      failures.push(
        violation(
          `${BASELINE_RELATIVE_PATH} (callers.${file})`,
          "this entry records no `occurrences` list, so it blanket-exempts the whole " +
            "file — a new call added beside the inherited ones would pass silently. " +
            "Re-seed it with `pnpm check:organization-callers --prune`.",
        ),
      );
      continue;
    }
    const unbaselined = fps.filter((fp) => !allowed.includes(fp));
    if (unbaselined.length === 0) continue;
    failures.push(
      violation(
        file,
        `${unbaselined.length} live call site(s) here are not among the ` +
          `${allowed.length} recorded in the baseline. Inherited debt is not a licence to ` +
          "add more, and not a licence to swap one baselined call for a different one at " +
          "the same count." +
          `\n      new:\n        ${unbaselined.join("\n        ")}` +
          `\n      baselined:\n        ${allowed.join("\n        ")}`,
      ),
    );
  }

  // ── the shrink-only ratchet, compared against history (F3 / check:env's pattern) ────
  try {
    const { base, previous } = readBaselineAtMergeBase(BASELINE_RELATIVE_PATH);
    if (previous) {
      for (const key of addedKeys(baseline.callers, previous.callers)) {
        failures.push(
          violation(
            `${BASELINE_RELATIVE_PATH} (callers)`,
            `"${key}" was ADDED to the baseline relative to the merge base ` +
              `${base.sha.slice(0, 9)} (${base.ref}). This list only ever shrinks: a live ` +
              "organization() caller is inherited debt, and appending a new file to the " +
              "baseline is how a new caller ships green in the same diff that adds it.",
          ),
        );
      }
      for (const { key, added } of addedWithinKeys(
        normaliseSection(baseline.callers, "occurrences"),
        normaliseSection(previous.callers, "occurrences"),
      )) {
        failures.push(
          violation(
            `${BASELINE_RELATIVE_PATH} (callers.${key})`,
            `${added.length} new call site(s) recorded under "${key}" relative to the ` +
              `merge base — ${added.join(", ")}. Growth inside an existing file's entry ` +
              "is still growth.",
          ),
        );
      }
    }
  } catch (error) {
    if (!(error instanceof BaselineHistoryUnavailableError)) throw error;
    failures.push(violation(BASELINE_RELATIVE_PATH, error.message));
  }

  const stale = [...baselineOccurrences.keys()].filter(
    (file) => !observed.has(file),
  );
  if (stale.length > 0) {
    warnings.push(
      `${stale.length} baselined file(s) no longer have any live call site — run ` +
        "`pnpm check:organization-callers --prune` to shrink the ratchet: " +
        `${stale.join(", ")}.`,
    );
  }

  warnings.push(
    `${totalCalls} live \`authClient.organization.*\` call site(s) across ${families.size} ` +
      `famil${families.size === 1 ? "y" : "ies"} in ${SCAN_ROOT}, defined at ` +
      `${rel(definition.file)}. This is the S10 precondition (docs/04-engineering/ci-cd.md, ` +
      "docs/07-planning/retrofits/organization-plugin-retrofit.md): S10 unmounts " +
      "organization() only once this reaches zero. The number must only fall.",
  );

  finish({
    name: NAME,
    failures,
    warnings,
    ok:
      totalCalls === 0
        ? "0 live authClient.organization.* call sites — S10's precondition holds"
        : `${totalCalls} live call site(s), all accounted for in ${BASELINE_RELATIVE_PATH}`,
  });
}

await main();

#!/usr/bin/env node
/**
 * check:overrides — exactly ONE dependency-override source may be populated.
 *
 * pnpm reads overrides from `pnpm.overrides` in the root package.json OR from
 * `overrides:` in pnpm-workspace.yaml. It honours ONE of them and emits NO warning
 * when both are populated: the other block becomes inert silently.
 *
 * That happened on this branch. #19 added a 16-entry `pnpm.overrides` to package.json
 * while pnpm-workspace.yaml already carried 30 entries, and the workspace block went
 * dead. Two version floors were breached the same day -- `path-to-regexp` regained 6.3.0
 * and `picomatch` regained 2.3.2 -- and `pnpm audit` stayed green throughout, because a
 * floor exists precisely where there is no advisory to find. Nineteen deliberate pins
 * were deactivated and nothing in the toolchain said a word.
 *
 * So this is not a style rule. It is the only mechanical signal that the protection you
 * think you have is still connected. pnpm-workspace.yaml is the canonical home; if you
 * need to move it, move ALL of it and leave one source populated.
 *
 * Also checks the inverse failure: a canonical source that has gone EMPTY. An empty
 * override set is indistinguishable from "we deleted the protection", so it fails too.
 */

import path from "node:path";
import { finish, readText, repoRoot, violation } from "./lib/repo.mjs";
import { readWorkspaceManifests } from "./lib/workspace-membership.mjs";

const NAME = "check:overrides";

const CANONICAL = "pnpm-workspace.yaml";

/**
 * Count the keys under a top-level `overrides:` mapping without a YAML dependency.
 * Deliberately literal: find the top-level key, then take the indented block until the
 * next top-level key. Comment and blank lines do not count as entries, and the word
 * "overrides:" inside a comment is not the key.
 */
function workspaceOverrideKeys(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^overrides:\s*(#.*)?$/.test(line));
  if (start === -1) return null;
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^\s+('[^']+'|"[^"]+"|[^:#\s]+)\s*:/);
    if (match) keys.push(match[1].replace(/^['"]|['"]$/g, ""));
  }
  return keys;
}

/**
 * L5 — the invariant said "exactly ONE override source may be populated", and the check
 * inspected two: root `pnpm.overrides` and pnpm-workspace.yaml. A NESTED package.json
 * `overrides` key was never looked at, and `apps/api/package.json` carried one
 * (`esbuild: ^0.25.0`) — inert, because pnpm honours overrides only from the workspace
 * root, and superseded anyway by the root's `^0.28.1`.
 *
 * Inert is not the same as harmless: it reads to a human as a live protection, and the
 * next person to trust it gets a floor that was never applied. The inert entry is
 * removed, and this now inspects every workspace manifest so the stated invariant and
 * the inspected surface are the same thing.
 *
 * **A5 — "every workspace manifest" was one level of `readdir` over a hardcoded
 * `["apps", "packages"]`,** under a comment that said "from the pnpm-workspace.yaml
 * globs". It was not: the workspace declares `packages/**` and `apps/**`, which are
 * RECURSIVE, so a package nested one directory deeper would have carried an override
 * source this gate could not see — the same claim-wider-than-its-inspection defect L5
 * closed one level up. Membership now comes from `lib/workspace-membership.mjs`, which
 * derives it from the workspace definition and fails closed when that cannot be read.
 * No package is nested deeper today, so the set is unchanged; the hole is what closed.
 */
async function nestedOverrideSources() {
  const found = [];
  for (const relative of await readWorkspaceManifests()) {
    if (relative === "package.json") continue; // the root is checked separately
    let manifest;
    try {
      manifest = JSON.parse(await readText(path.join(repoRoot, relative)));
    } catch {
      continue;
    }
    const nested = {
      ...(manifest?.overrides ?? {}),
      ...(manifest?.pnpm?.overrides ?? {}),
      ...(manifest?.resolutions ?? {}),
    };
    if (Object.keys(nested).length > 0) {
      found.push({ relative, keys: Object.keys(nested) });
    }
  }
  return found;
}

async function main() {
  const failures = [];

  const manifestText = await readText(path.join(repoRoot, "package.json"));
  const manifest = JSON.parse(manifestText);
  const manifestOverrides = manifest?.pnpm?.overrides ?? null;
  const manifestKeys = manifestOverrides ? Object.keys(manifestOverrides) : [];

  const workspaceText = await readText(path.join(repoRoot, CANONICAL));
  const workspaceKeys = workspaceOverrideKeys(workspaceText);

  const populated = [];
  if (manifestKeys.length > 0) populated.push("package.json `pnpm.overrides`");
  if ((workspaceKeys?.length ?? 0) > 0)
    populated.push(`${CANONICAL} \`overrides:\``);

  if (populated.length > 1) {
    failures.push(
      violation(
        populated.join(" + "),
        `two override sources are populated at once (${manifestKeys.length} in package.json, ` +
          `${workspaceKeys.length} in ${CANONICAL}). pnpm honours ONE and silently ignores the ` +
          "other -- it prints no warning, and `pnpm audit` cannot see a deactivated version " +
          `floor. Keep ${CANONICAL} as the single home and delete the package.json block, ` +
          "merging any entry it adds.",
      ),
    );
  }

  if (populated.length === 0) {
    failures.push(
      violation(
        CANONICAL,
        "no override source is populated. The inherited graph carries pins and floors that " +
          "close real advisories; an empty override set is not a clean state, it is the " +
          "protection removed. If that is deliberate it needs a decision-log entry.",
      ),
    );
  }

  // The canonical source must be the populated one, so a future move is explicit.
  if (populated.length === 1 && manifestKeys.length > 0) {
    failures.push(
      violation(
        "package.json `pnpm.overrides`",
        `overrides live in ${CANONICAL} in this repository. They are declared in ` +
          "package.json instead, which works but relocates a security-relevant surface " +
          "without a record. Move them back, or change this check and say why.",
      ),
    );
  }

  // L5: nested manifests, so the invariant matches the inspected surface.
  for (const { relative, keys } of await nestedOverrideSources()) {
    failures.push(
      violation(
        relative,
        `declares ${keys.length} dependency override(s) — ${keys.join(", ")} — in a ` +
          "NON-ROOT manifest. pnpm honours overrides only from the workspace root, so " +
          "these are INERT: they read as a protection to anyone reviewing this file and " +
          `apply to nothing. Move them into ${CANONICAL}, where they take effect, or ` +
          "delete them.",
      ),
    );
  }

  finish({
    name: NAME,
    failures,
    ok:
      `${workspaceKeys?.length ?? 0} override(s) in ${CANONICAL}, ` +
      "and no competing source",
  });
}

await main();

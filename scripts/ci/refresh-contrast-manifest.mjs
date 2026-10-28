#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectContrastSourcePaths,
  observedPairsInSources,
  observeInheritedForegroundSurfaces,
  validatePairManifest,
} from "./check-contrast.mjs";
import { repoRoot } from "./lib/repo.mjs";

const manifestPath = "packages/ui/src/styles/pairs.json";

function foregroundUtility(foregroundClass, fg) {
  const defaultClass = fg.replace(/^--color-/, "text-");
  const utility = foregroundClass?.split(":").at(-1);
  return utility && utility !== defaultClass ? utility : undefined;
}

function manifestKey(pair, theme) {
  const backgroundClass = pair.backgroundClass?.[theme];
  if (!backgroundClass) return undefined;
  const backdrop = pair.backdropLayers?.length
    ? `|backdrop:${pair.backdropLayers.join(">")}`
    : "";
  const utility = foregroundUtility(pair.foregroundClass, pair.fg);
  return `${pair.fg}|${pair.bg}|${backgroundClass}|${theme}${backdrop}${
    utility ? `|${utility}` : ""
  }`;
}

function occurrenceRecord(occurrence) {
  return {
    backdropLayers: [...(occurrence.backdropLayers ?? [])],
    category: occurrence.category,
    chain: [...occurrence.chain],
    id: occurrence.id,
    surfaceContext: occurrence.surfaceContext,
    usage: occurrence.usage,
  };
}

function sortedUniqueOccurrences(occurrences) {
  const byIdentity = new Map();
  for (const raw of occurrences) {
    const occurrence = occurrenceRecord(raw);
    const identity = JSON.stringify(occurrence);
    byIdentity.set(identity, occurrence);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.usage.localeCompare(right.usage) ||
      left.id.localeCompare(right.id) ||
      left.surfaceContext.localeCompare(right.surfaceContext) ||
      JSON.stringify(left.chain).localeCompare(JSON.stringify(right.chain)),
  );
}

function terminalBackdrop(backgroundClass, backdropLayers) {
  const source = backdropLayers.at(-1) ?? backgroundClass;
  const token = source.match(/(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u)?.[1];
  return token ? `--color-${token}` : undefined;
}

function strongestCategory(occurrences) {
  return occurrences.some((occurrence) => occurrence.category === "body")
    ? "body"
    : "non-text";
}

function observedEntries(observedPairs) {
  const entries = [];
  for (const key of [...observedPairs].sort()) {
    const parts = key.split("|");
    const [fg, bg, backgroundClass, theme] = parts;
    if (!fg || !bg || !backgroundClass || !["light", "dark"].includes(theme))
      throw new Error(`Cannot refresh malformed observed pair key: ${key}`);
    let index = 4;
    let backdropLayers = [];
    if (parts[index]?.startsWith("backdrop:")) {
      backdropLayers = parts[index].slice("backdrop:".length).split(">");
      index += 1;
    }
    const foregroundUtility = parts[index];
    const occurrences = sortedUniqueOccurrences(
      observedPairs.occurrences?.get(key) ?? [],
    );
    if (occurrences.length === 0) {
      throw new Error(
        `Observed pair ${key} has no source occurrence records; refusing to invent provenance.`,
      );
    }
    if (
      occurrences.some(
        (occurrence) =>
          JSON.stringify(occurrence.backdropLayers) !==
          JSON.stringify(backdropLayers),
      )
    ) {
      throw new Error(
        `Observed pair ${key} has occurrence backdrop records that disagree with its key.`,
      );
    }
    const backdrop = terminalBackdrop(backgroundClass, backdropLayers);
    if (!backdrop) {
      throw new Error(`Observed pair ${key} has no supported backdrop token.`);
    }
    const occurrenceIds = [...new Set(occurrences.map(({ id }) => id))];
    const foregroundClass =
      observedPairs.pairDetails?.get(key)?.foregroundClass;
    entries.push({
      fg,
      bg,
      category: strongestCategory(occurrences),
      minRatio: strongestCategory(occurrences) === "body" ? 4.5 : 3,
      themes: [theme],
      usage: occurrences[0].usage,
      backdrop,
      foregroundClass:
        foregroundClass ??
        foregroundUtility ??
        fg.replace(/^--color-/, "text-"),
      backgroundClass: { [theme]: backgroundClass },
      surfaceContext: occurrences[0].surfaceContext,
      occurrenceIds,
      occurrences,
      ...(backdropLayers.length ? { backdropLayers } : {}),
    });
  }
  return entries;
}

function oldManifestKeys(pairs) {
  const keys = new Set();
  for (const pair of pairs) {
    for (const theme of pair.themes ?? []) {
      const key = manifestKey(pair, theme);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function staleContrastManifestKeys(existingPairs, observedPairs) {
  const observedKeys = new Set(observedPairs);
  return [...oldManifestKeys(existingPairs)]
    .filter((key) => !observedKeys.has(key))
    .sort();
}

export function refreshContrastManifest(
  existingPairs,
  observedPairs,
  { acknowledgedRemovals = [] } = {},
) {
  const nextPairs = observedEntries(observedPairs);
  const stale = staleContrastManifestKeys(existingPairs, observedPairs);
  const acknowledged = acknowledgedRemovals;
  const staleSet = new Set(stale);
  const acknowledgedSet = new Set(acknowledged);
  if (acknowledgedSet.size !== acknowledged.length) {
    throw new Error(
      "Removal acknowledgements must not contain duplicate keys.",
    );
  }
  const missingAcknowledgements = stale.filter(
    (key) => !acknowledgedSet.has(key),
  );
  const unexpectedAcknowledgements = acknowledged.filter(
    (key) => !staleSet.has(key),
  );
  if (missingAcknowledgements.length || unexpectedAcknowledgements.length) {
    throw new Error(
      [
        "Manifest removals require an exact reviewable acknowledgement list.",
        ...(missingAcknowledgements.length
          ? [
              "Unacknowledged stale keys:",
              ...missingAcknowledgements.map((key) => `  ${key}`),
            ]
          : []),
        ...(unexpectedAcknowledgements.length
          ? [
              "Acknowledged keys that are not stale:",
              ...unexpectedAcknowledgements.map((key) => `  ${key}`),
            ]
          : []),
      ].join("\n"),
    );
  }
  return nextPairs;
}

export function contrastManifestChangeSummary(existingPairs, nextPairs) {
  const previous = oldManifestKeys(existingPairs);
  const next = oldManifestKeys(nextPairs);
  return {
    added: [...next].filter((key) => !previous.has(key)).sort(),
    removed: [...previous].filter((key) => !next.has(key)).sort(),
    retained: [...next].filter((key) => previous.has(key)).sort(),
  };
}

export async function analyzeCurrentContrastSources() {
  const sourcePaths = await collectContrastSourcePaths();
  const sourceText = await Promise.all(
    sourcePaths.map((file) => readFile(path.join(repoRoot, file), "utf8")),
  );
  const theme = await readFile(
    path.join(repoRoot, "packages/ui/src/styles/theme.css"),
    "utf8",
  );
  const tokenNames = new Set(
    [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map((match) => match[1]),
  );
  tokenNames.add("white");
  const translucentBackgroundTokens = new Set(
    [...theme.matchAll(/--([a-z0-9-]+)\s*:\s*--alpha\(/gu)].map(
      (match) => match[1],
    ),
  );
  const observed = observedPairsInSources(
    sourceText,
    tokenNames,
    sourcePaths,
    translucentBackgroundTokens,
  );
  const inherited = observeInheritedForegroundSurfaces(
    sourcePaths,
    tokenNames,
    undefined,
    { trackReachability: true },
  );
  for (const key of inherited.pairs) observed.add(key);
  observed.inheritedUses = inherited.uses;
  observed.importedUses = inherited.importedUses;
  observed.routeUses = inherited.routeUses;
  observed.callerUses = inherited.callerUses;
  observed.directOccurrenceUses = inherited.directOccurrenceUses;
  observed.occurrences = inherited.uses.occurrences;
  for (const [key, details] of inherited.pairDetails) {
    if (!observed.pairDetails.has(key)) observed.pairDetails.set(key, details);
  }
  return { observed, inherited };
}

async function main() {
  let write = false;
  let acknowledgementPath;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--write") write = true;
    else if (args[index] === "--acknowledge-removals") {
      acknowledgementPath = args[index + 1];
      if (!acknowledgementPath)
        throw new Error("--acknowledge-removals requires a JSON file path.");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  const fullPath = path.join(repoRoot, manifestPath);
  const existing = JSON.parse(await readFile(fullPath, "utf8"));
  const { observed, inherited } = await analyzeCurrentContrastSources();
  const failures = [];
  for (const unsupported of observed.unsupportedForegrounds ?? []) {
    failures.push(
      `${unsupported.usage ?? manifestPath}: unsupported semantic foreground ${unsupported.className}.`,
    );
  }
  for (const entry of inherited.unresolved.values()) {
    failures.push(
      `${entry.usage ?? manifestPath}: foreground-only color occurrence ${entry.id} has no supported opaque surface.`,
    );
  }
  let nextPairs;
  let acknowledgedRemovals = [];
  if (acknowledgementPath) {
    acknowledgedRemovals = JSON.parse(
      await readFile(path.resolve(process.cwd(), acknowledgementPath), "utf8"),
    );
    if (
      !Array.isArray(acknowledgedRemovals) ||
      acknowledgedRemovals.some((key) => typeof key !== "string")
    ) {
      failures.push(
        "Removal acknowledgement file must contain a JSON string array.",
      );
    }
  }
  try {
    nextPairs = refreshContrastManifest(existing, observed, {
      acknowledgedRemovals,
    });
  } catch (error) {
    failures.push(error.message);
    try {
      nextPairs = observedEntries(observed);
    } catch (buildError) {
      failures.push(buildError.message);
    }
  }
  const changes = nextPairs
    ? contrastManifestChangeSummary(existing, nextPairs)
    : undefined;
  if (changes)
    console.log(
      JSON.stringify({ manifest: manifestPath, ...changes }, null, 2),
    );
  if (nextPairs) {
    const validation = validatePairManifest(
      nextPairs,
      (file) => {
        try {
          return readFileSync(path.join(repoRoot, file), "utf8");
        } catch {
          return "";
        }
      },
      observed,
    );
    failures.push(...validation);
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }
  if (write) {
    await writeFile(fullPath, `${JSON.stringify(nextPairs, null, 2)}\n`);
    console.log(`Wrote ${nextPairs.length} source-grounded entries.`);
  } else {
    console.log("Dry run only; pass --write to update the manifest.");
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();

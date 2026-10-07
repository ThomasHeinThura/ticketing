import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAYOUT_EVENTS = new Set([
  "UpdateLayoutTree",
  "Layout",
  "RecalculateStyles",
  "PrePaint",
  "Paint",
]);

export function summarizeLayoutEvents(events) {
  return events
    .filter((event) => LAYOUT_EVENTS.has(event.name))
    .map(({ name, cat, ph, ts, dur, pid, tid }) => ({
      name,
      category: cat,
      phase: ph,
      timestampMicroseconds: ts,
      durationMicroseconds: dur ?? 0,
      processId: pid,
      threadId: tid,
    }));
}

export function summarizeCpuProfile(profile) {
  const nodes = Array.isArray(profile?.nodes) ? profile.nodes : [];
  return {
    nodeCount: nodes.length,
    parentEdgeCount: nodes.reduce(
      (total, node) =>
        total + (Array.isArray(node.children) ? node.children.length : 0),
      0,
    ),
    sampleCount: Array.isArray(profile?.samples) ? profile.samples.length : 0,
    nodes,
    samples: profile?.samples ?? [],
    timeDeltas: profile?.timeDeltas ?? [],
    startTime: profile?.startTime,
    endTime: profile?.endTime,
  };
}

export function assetMapPathFromScriptUrl(scriptUrl, baseUrl, assetsDirectory) {
  const parsed = new URL(scriptUrl);
  const expectedOrigin = new URL(baseUrl).origin;
  if (
    parsed.origin !== expectedOrigin ||
    !parsed.pathname.startsWith("/assets/")
  ) {
    return null;
  }

  const filename = path.posix.basename(parsed.pathname);
  if (!/^[-\w.]+\.js$/.test(filename)) return null;
  const assetsRoot = path.resolve(assetsDirectory);
  const mapPath = path.join(assetsRoot, `${filename}.map`);
  if (path.dirname(mapPath) !== assetsRoot) {
    throw new Error("Source map path escaped the build asset directory");
  }
  return mapPath;
}

export async function readSafeSourceMap(mapPath, assetsDirectory) {
  const assetsRoot = await realpath(assetsDirectory);
  const resolved = path.resolve(mapPath);
  if (path.dirname(resolved) !== assetsRoot) {
    throw new Error("Source map path is outside the build asset directory");
  }
  const details = await lstat(resolved);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error("Source map is missing or unsafe");
  }
  if ((await realpath(resolved)) !== resolved) {
    throw new Error("Source map resolves outside the build asset directory");
  }
  const contents = await readFile(resolved);
  const parsed = JSON.parse(contents.toString("utf8"));
  if (parsed.version !== 3 || !Array.isArray(parsed.sources)) {
    throw new Error("Source map has an unsupported structure");
  }
  return {
    contents,
    sha256: createHash("sha256").update(contents).digest("hex"),
    sources: parsed.sources,
    sourceCount: parsed.sources.length,
  };
}

export async function resolveOwnedTraceDirectory(rawPath) {
  if (!rawPath || !path.isAbsolute(rawPath)) {
    throw new Error("Trace output directory must be an absolute path");
  }
  const candidate = path.resolve(rawPath);
  if (
    !/taskdesk-g11-ab-[0-9]+\/(?:accepted-f10|current-10034)\/board-attribution$/.test(
      candidate,
    )
  ) {
    throw new Error(
      "Trace output directory is outside the owned evidence layout",
    );
  }
  const runRoot = path.dirname(path.dirname(candidate));
  const sourceDirectory = path.dirname(candidate);
  for (const directory of [runRoot, sourceDirectory, candidate]) {
    const details = await lstat(directory);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error("Trace output directory is missing or unsafe");
    }
    if (
      (details.mode & 0o077) !== 0 ||
      (await realpath(directory)) !== directory
    ) {
      throw new Error("Trace output directory permissions or path are unsafe");
    }
  }
  return candidate;
}

export function requireCpuParentGraph(profile) {
  const summary = summarizeCpuProfile(profile);
  if (summary.nodeCount < 2 || summary.parentEdgeCount < 1) {
    throw new Error(
      "Chrome CPU profile did not retain parent-child call edges",
    );
  }
  return summary;
}

async function main(args) {
  const [command, outputPath] = args;
  if (command === "preflight" && args.length === 2) {
    const output = await resolveOwnedTraceDirectory(outputPath);
    process.stdout.write(`trace_output_dir=${output}\n`);
    return;
  }
  throw new Error(
    "Usage: board-trace-evidence.mjs preflight <owned-output-directory>",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

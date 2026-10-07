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
  let parsed;
  try {
    parsed = new URL(scriptUrl);
  } catch {
    return null;
  }
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

export async function resolveOwnedTraceDirectory(rawPath, ownership) {
  const { runnerTemp, runId, runSha, repo, sourceName } = ownership ?? {};
  if (!rawPath || !path.isAbsolute(rawPath)) {
    throw new Error("Trace output directory must be an absolute path");
  }
  if (
    typeof runnerTemp !== "string" ||
    typeof repo !== "string" ||
    !/^\d+$/.test(runId ?? "") ||
    !/^[a-f0-9]{40}$/.test(runSha ?? "") ||
    !["accepted-f10", "current-10034"].includes(sourceName)
  ) {
    throw new Error(
      "Trace directory ownership metadata is incomplete or invalid",
    );
  }
  const candidate = path.resolve(rawPath);
  const evidenceRoot = path.resolve(runnerTemp, `taskdesk-g11-ab-${runId}`);
  const expected = path.join(evidenceRoot, sourceName, "board-attribution");
  if (candidate !== expected) {
    throw new Error(
      "Trace output directory is outside the run-owned evidence path",
    );
  }

  const markerPath = path.join(evidenceRoot, ".taskdesk-owned-evidence");
  let marker;
  try {
    marker = await lstat(markerPath);
  } catch {
    throw new Error("Evidence ownership marker is missing or unsafe");
  }
  if (
    marker.isSymbolicLink() ||
    !marker.isFile() ||
    (marker.mode & 0o077) !== 0
  ) {
    throw new Error("Evidence ownership marker is missing or unsafe");
  }
  const expectedMarker = `run_id=${runId}\nworkflow_sha=${runSha}\nrepo=${path.resolve(repo)}\n`;
  if ((await readFile(markerPath, "utf8")) !== expectedMarker) {
    throw new Error("Evidence ownership marker does not match this run");
  }

  for (const directory of [evidenceRoot, path.dirname(candidate), candidate]) {
    let details;
    try {
      details = await lstat(directory);
    } catch {
      throw new Error("Trace output directory is missing or unsafe");
    }
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

export async function withCdpTraceLifecycle(session, captureBody) {
  let tracingStarted = false;
  let profilerStarted = false;
  let result;
  let profile;
  let traceCompletion;
  let captureError;
  const cleanupErrors = [];

  try {
    await session.send("Debugger.enable");
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });
    await session.send("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires,blink.user_timing",
      transferMode: "ReportEvents",
    });
    tracingStarted = true;
    await session.send("Profiler.start");
    profilerStarted = true;
    result = await captureBody();
  } catch (error) {
    captureError = error;
  }

  if (profilerStarted) {
    try {
      ({ profile } = await session.send("Profiler.stop"));
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (tracingStarted) {
    try {
      const completion = new Promise((resolve) =>
        session.once("Tracing.tracingComplete", resolve),
      );
      await session.send("Tracing.end");
      traceCompletion = await completion;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await session.detach();
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (captureError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [captureError, ...cleanupErrors],
      "CDP capture and cleanup both failed.",
    );
  }
  if (captureError) throw captureError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "CDP capture cleanup failed.");
  }
  if (!profile || !traceCompletion) {
    throw new Error(
      "CDP capture did not return the CPU profile and trace completion",
    );
  }
  return { result, profile, traceCompletion };
}

async function main(args) {
  const [command, outputPath, sourceName] = args;
  if (command === "preflight" && args.length === 3) {
    const output = await resolveOwnedTraceDirectory(outputPath, {
      runnerTemp: process.env.RUNNER_TEMP,
      runId: process.env.GITHUB_RUN_ID,
      runSha: process.env.GITHUB_SHA,
      repo: process.env.GITHUB_WORKSPACE,
      sourceName,
    });
    process.stdout.write(`trace_output_dir=${output}\n`);
    return;
  }
  throw new Error(
    "Usage: board-trace-evidence.mjs preflight <output-directory> <source-name>",
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

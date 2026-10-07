import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assetMapPathFromScriptUrl,
  readSafeSourceMap,
  requireCpuParentGraph,
  resolveOwnedTraceDirectory,
  summarizeLayoutEvents,
  withCdpTraceLifecycle,
} from "./board-trace-evidence.mjs";

test("layout trace summary retains only paint and layout event timing", () => {
  const summary = summarizeLayoutEvents([
    {
      name: "UpdateLayoutTree",
      cat: "devtools.timeline",
      ph: "X",
      ts: 5,
      dur: 8,
      pid: 1,
      tid: 2,
      args: { token: "discard" },
    },
    {
      name: "Layout",
      cat: "devtools.timeline",
      ph: "X",
      ts: 13,
      dur: 4,
      pid: 1,
      tid: 2,
    },
    {
      name: "FunctionCall",
      cat: "devtools.timeline",
      ph: "X",
      ts: 1,
      dur: 20,
      pid: 1,
      tid: 2,
    },
  ]);
  assert.deepEqual(
    summary.map((event) => event.name),
    ["UpdateLayoutTree", "Layout"],
  );
  assert.equal(JSON.stringify(summary).includes("discard"), false);
  assert.equal(summary[0].durationMicroseconds, 8);
});

test("CPU profile summary requires and preserves hierarchical parent edges", () => {
  const profile = requireCpuParentGraph({
    nodes: [
      {
        id: 1,
        callFrame: { functionName: "root", url: "x.js" },
        children: [2],
      },
      {
        id: 2,
        callFrame: { functionName: "render", url: "x.js" },
        children: [],
      },
    ],
    samples: [2],
    timeDeltas: [100],
  });
  assert.equal(profile.nodeCount, 2);
  assert.equal(profile.parentEdgeCount, 1);
  assert.deepEqual(profile.nodes[0].children, [2]);
  assert.throws(
    () =>
      requireCpuParentGraph({ nodes: [{ id: 1, callFrame: {} }], samples: [] }),
    /parent-child call edges/,
  );
});

test("script URL mapping requires the exact preview origin and safe asset name", () => {
  const assets = path.join(tmpdir(), "assets");
  assert.equal(
    assetMapPathFromScriptUrl(
      "http://127.0.0.1:4178/assets/board-abc.js",
      "http://127.0.0.1:4178",
      assets,
    ),
    path.join(assets, "board-abc.js.map"),
  );
  assert.equal(
    assetMapPathFromScriptUrl(
      "https://outside.test/assets/board-abc.js",
      "http://127.0.0.1:4178",
      assets,
    ),
    null,
  );
  assert.equal(
    assetMapPathFromScriptUrl(
      "http://127.0.0.1:4178/assets/../secret.js",
      "http://127.0.0.1:4178",
      assets,
    ),
    null,
  );
  for (const scriptUrl of [
    "relative.js",
    "not a URL",
    "",
    "/assets/board.js",
  ]) {
    assert.equal(
      assetMapPathFromScriptUrl(scriptUrl, "http://127.0.0.1:4178", assets),
      null,
      `unexpected map path for ${JSON.stringify(scriptUrl)}`,
    );
  }
});

test("source-map reads fail closed for missing, malformed and symlink assets", async () => {
  const assets = await realpath(
    await mkdtemp(path.join(tmpdir(), "taskdesk-trace-assets-")),
  );
  const outside = await realpath(
    await mkdtemp(path.join(tmpdir(), "taskdesk-trace-outside-")),
  );
  const good = path.join(assets, "board.js.map");
  const link = path.join(assets, "linked.js.map");
  try {
    await writeFile(
      good,
      JSON.stringify({ version: 3, sources: ["src/board.ts"] }),
    );
    const result = await readSafeSourceMap(good, assets);
    assert.equal(result.sourceCount, 1);
    await writeFile(
      path.join(outside, "map.json"),
      JSON.stringify({ version: 3, sources: [] }),
    );
    await symlink(path.join(outside, "map.json"), link);
    await assert.rejects(readSafeSourceMap(link, assets), /missing or unsafe/);
    await assert.rejects(
      readSafeSourceMap(path.join(assets, "missing.js.map"), assets),
    );
    await writeFile(path.join(assets, "invalid.js.map"), "{}");
    await assert.rejects(
      readSafeSourceMap(path.join(assets, "invalid.js.map"), assets),
      /unsupported structure/,
    );
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

async function createOwnedEvidence(root, { sourceName = "accepted-f10" } = {}) {
  const runnerTemp = await realpath(root);
  const runId = "12345";
  const runSha = "a".repeat(40);
  const repo = path.join(runnerTemp, "repo");
  const evidenceRoot = path.join(runnerTemp, `taskdesk-g11-ab-${runId}`);
  const output = path.join(evidenceRoot, sourceName, "board-attribution");
  await mkdir(output, { recursive: true, mode: 0o700 });
  await chmod(evidenceRoot, 0o700);
  await chmod(path.dirname(output), 0o700);
  await chmod(output, 0o700);
  const markerPath = path.join(evidenceRoot, ".taskdesk-owned-evidence");
  await writeFile(
    markerPath,
    `run_id=${runId}\nworkflow_sha=${runSha}\nrepo=${path.resolve(repo)}\n`,
    { mode: 0o600 },
  );
  await chmod(markerPath, 0o600);
  return {
    runnerTemp,
    runId,
    runSha,
    repo,
    sourceName,
    evidenceRoot,
    markerPath,
    output,
  };
}

test("trace output is bound to the private run marker and exact source path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "taskdesk-g11-owner-"));
  try {
    const owner = await createOwnedEvidence(root);
    assert.equal(
      await resolveOwnedTraceDirectory(owner.output, owner),
      owner.output,
    );
    const cli = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./board-trace-evidence.mjs", import.meta.url)),
        "preflight",
        owner.output,
        owner.sourceName,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RUNNER_TEMP: owner.runnerTemp,
          GITHUB_RUN_ID: owner.runId,
          GITHUB_SHA: owner.runSha,
          GITHUB_WORKSPACE: owner.repo,
        },
      },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /trace_output_dir=/);

    const invalid = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./board-trace-evidence.mjs", import.meta.url)),
        "preflight",
        owner.output,
        "current-10034",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RUNNER_TEMP: owner.runnerTemp,
          GITHUB_RUN_ID: owner.runId,
          GITHUB_SHA: owner.runSha,
          GITHUB_WORKSPACE: owner.repo,
        },
      },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /outside the run-owned evidence path/);

    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, {
        ...owner,
        runId: "12346",
      }),
      /outside the run-owned evidence path/,
    );
    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, {
        ...owner,
        runSha: "b".repeat(40),
      }),
      /ownership marker does not match/,
    );
    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, {
        ...owner,
        runnerTemp: path.join(root, "elsewhere"),
      }),
      /outside the run-owned evidence path/,
    );
    await rm(owner.markerPath);
    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, owner),
      /ownership marker is missing or unsafe/,
    );
    await writeFile(owner.markerPath, "wrong owner\n", { mode: 0o600 });
    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, owner),
      /ownership marker does not match/,
    );
    await rm(owner.markerPath);
    const outsideMarker = path.join(root, "outside-marker");
    await writeFile(outsideMarker, "not used\n", { mode: 0o600 });
    await symlink(outsideMarker, owner.markerPath);
    await assert.rejects(
      resolveOwnedTraceDirectory(owner.output, owner),
      /ownership marker is missing or unsafe/,
    );

    const linked = path.join(
      owner.evidenceRoot,
      "current-10034",
      "board-attribution",
    );
    await symlink(owner.output, path.dirname(linked), "dir");
    await assert.rejects(
      resolveOwnedTraceDirectory(linked, {
        ...owner,
        sourceName: "current-10034",
      }),
      /missing or unsafe/,
    );
    await assert.rejects(
      resolveOwnedTraceDirectory("relative/path", owner),
      /absolute path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class FakeCdpSession extends EventEmitter {
  calls = [];
  fail = new Set();

  async send(command) {
    this.calls.push(command);
    if (this.fail.has(command)) throw new Error(`${command} failed`);
    if (command === "Profiler.stop") {
      return {
        profile: {
          nodes: [
            { id: 1, children: [2] },
            { id: 2, children: [] },
          ],
          samples: [2],
        },
      };
    }
    if (command === "Tracing.end") {
      queueMicrotask(() => this.emit("Tracing.tracingComplete", { value: [] }));
    }
    return {};
  }

  async detach() {
    this.calls.push("detach");
    if (this.fail.has("detach")) throw new Error("detach failed");
  }
}

test("CDP trace lifecycle stops, ends and detaches after successful capture", async () => {
  const session = new FakeCdpSession();
  const result = await withCdpTraceLifecycle(session, async () => "captured");
  assert.equal(result.result, "captured");
  assert.deepEqual(result.profile.nodes[0].children, [2]);
  assert.deepEqual(result.traceCompletion, { value: [] });
  assert.deepEqual(session.calls.slice(-3), [
    "Profiler.stop",
    "Tracing.end",
    "detach",
  ]);
});

test("CDP lifecycle cleans up after capture and individual cleanup failures", async () => {
  const failedCapture = new FakeCdpSession();
  await assert.rejects(
    withCdpTraceLifecycle(failedCapture, async () => {
      throw new Error("navigation failed");
    }),
    /navigation failed/,
  );
  assert.deepEqual(failedCapture.calls.slice(-3), [
    "Profiler.stop",
    "Tracing.end",
    "detach",
  ]);

  const failedStop = new FakeCdpSession();
  failedStop.fail.add("Profiler.stop");
  await assert.rejects(
    withCdpTraceLifecycle(failedStop, async () => "captured"),
    /CDP capture cleanup failed/,
  );
  assert.deepEqual(failedStop.calls.slice(-3), [
    "Profiler.stop",
    "Tracing.end",
    "detach",
  ]);

  const failedStart = new FakeCdpSession();
  failedStart.fail.add("Tracing.start");
  await assert.rejects(
    withCdpTraceLifecycle(failedStart, async () => "unreachable"),
    /Tracing.start failed/,
  );
  assert.equal(failedStart.calls.at(-1), "detach");
  assert.equal(failedStart.calls.includes("Tracing.end"), false);

  const failedProfilerStart = new FakeCdpSession();
  failedProfilerStart.fail.add("Profiler.start");
  await assert.rejects(
    withCdpTraceLifecycle(failedProfilerStart, async () => "unreachable"),
    /Profiler.start failed/,
  );
  assert.deepEqual(failedProfilerStart.calls.slice(-2), [
    "Tracing.end",
    "detach",
  ]);

  const failedTraceEnd = new FakeCdpSession();
  failedTraceEnd.fail.add("Tracing.end");
  await assert.rejects(
    withCdpTraceLifecycle(failedTraceEnd, async () => "captured"),
    /CDP capture cleanup failed/,
  );
  assert.deepEqual(failedTraceEnd.calls.slice(-2), ["Tracing.end", "detach"]);
});

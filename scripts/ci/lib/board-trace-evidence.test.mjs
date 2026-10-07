import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

test("trace output requires an owned private evidence directory and rejects unsafe paths", async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "taskdesk-g11-ab-12345-")),
  );
  const output = path.join(
    root,
    "taskdesk-g11-ab-12345",
    "accepted-f10",
    "board-attribution",
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  try {
    assert.equal(await resolveOwnedTraceDirectory(output), output);
    const cli = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./board-trace-evidence.mjs", import.meta.url)),
        "preflight",
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /trace_output_dir=/);
    const invalid = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./board-trace-evidence.mjs", import.meta.url)),
        "preflight",
        path.join(root, "outside"),
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /owned evidence layout/);
    await assert.rejects(
      resolveOwnedTraceDirectory(path.join(root, "outside")),
      /owned evidence layout/,
    );
    const linked = path.join(
      root,
      "taskdesk-g11-ab-12345",
      "current-10034",
      "board-attribution",
    );
    await rm(path.dirname(linked), { recursive: true, force: true });
    await mkdir(path.dirname(linked), { recursive: true, mode: 0o700 });
    await symlink(output, linked, "dir");
    await assert.rejects(
      resolveOwnedTraceDirectory(linked),
      /missing or unsafe/,
    );
    await assert.rejects(
      resolveOwnedTraceDirectory("relative/path"),
      /absolute path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

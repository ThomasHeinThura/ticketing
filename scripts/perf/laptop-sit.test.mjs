import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readPrivateJson, validateManifest } from "./laptop-sit.mjs";

const manifest = () => ({
  version: 1,
  syntheticOnly: true,
  runId: "unit-only",
  workspaceId: "ws",
  organisationId: "org",
  staffEmail: "fixture@example.test",
  credentialsFile: "/private/input.json",
  agentOrigin: "http://localhost:1337",
  portalOrigin: "http://portal.localhost:1337",
  ...Object.fromEntries(
    [
      ["list", 500],
      ["board", 200],
    ].map(([kind, count]) => [
      kind,
      {
        projectId: kind,
        projectKey: kind,
        items: Array.from({ length: count }, (_, i) => ({
          id: `${kind}-${i}`,
          key: `${kind}-${i}`,
        })),
      },
    ]),
  ),
});
test("requires exact isolated 500/200 receipts and local distinct origins", () => {
  assert.equal(validateManifest(manifest()).list.items.length, 500);
  for (const mutate of [
    (m) => m.list.items.pop(),
    (m) => (m.board.items[0] = m.list.items[0]),
    (m) => (m.syntheticOnly = false),
    (m) => (m.portalOrigin = m.agentOrigin),
    (m) => (m.agentOrigin = "https://production.example"),
    (m) => (m.board.projectId = m.list.projectId),
  ]) {
    const input = manifest();
    mutate(input);
    assert.throws(() => validateManifest(input), /Invalid private G11 input/);
  }
});
test("private input rejects public modes, symlinks, checkout files and redacts payload errors", () => {
  const dir = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), "g11-private-unit-"),
  );
  try {
    const file = path.join(dir, "input.json");
    writeFileSync(file, '{"canary":"SECRET-CANARY"}', { mode: 0o600 });
    assert.equal(readPrivateJson(file).canary, "SECRET-CANARY");
    chmodSync(file, 0o644);
    assert.throws(() => readPrivateJson(file));
    chmodSync(file, 0o600);
    const link = path.join(dir, "link.json");
    symlinkSync(file, link);
    assert.throws(() => readPrivateJson(link));
    assert.throws(() => readPrivateJson(file, dir));
    writeFileSync(file, "SECRET-CANARY");
    assert.throws(
      () => readPrivateJson(file),
      (error) => !String(error).includes("SECRET-CANARY"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

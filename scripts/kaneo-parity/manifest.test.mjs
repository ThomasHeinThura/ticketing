import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  expectedCaptures,
  SCREENS,
  sha256,
  sourceIdentity,
  UPSTREAM_SHA,
  validateManifest,
  validatePair,
  validatePlan,
} from "./manifest.mjs";
import { runComparison } from "./run-comparison.mjs";

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function temporary() {
  const root = mkdtempSync(path.join(tmpdir(), "taskdesk-parity-unit-"));
  roots.push(root);
  return root;
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
const imageCache = new Map();
function png(width, height, red = 0) {
  const key = `${width}:${height}:${red}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * (width * 4 + 1) + 1 + col * 4;
      pixels[i] = red;
      pixels[i + 3] = 255;
    }
  const result = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  imageCache.set(key, result);
  return result;
}
function fixture(side, root = temporary()) {
  const directory = path.join(root, side);
  mkdirSync(directory);
  const seed = Buffer.from('{"records":[{"title":"persisted-fixture"}]}');
  writeFileSync(path.join(directory, "seed-export.json"), seed);
  const digest = sha256("verified fixture probe");
  const manifest = {
    version: 1,
    side,
    source: {
      sha: side === "upstream" ? UPSTREAM_SHA : "a".repeat(40),
      worktreeSha256: sha256(""),
      dirty: false,
    },
    seed: {
      kind: "persisted-api-export",
      sha256: sha256(seed),
      probes: [
        {
          status: 200,
          passed: true,
          responseSha256: digest,
          expectedSha256: digest,
          observedSha256: digest,
        },
      ],
    },
    render: {
      engine: "chromium",
      browserVersion: "unit-fixture",
      platform: "unit",
      arch: "unit",
      locale: "en-GB",
      timezoneId: "UTC",
      reducedMotion: "reduce",
      animations: "disabled",
    },
    captures: expectedCaptures().map((spec) => {
      const bytes = png(spec.viewport.width, spec.viewport.height);
      writeFileSync(path.join(directory, spec.file), bytes);
      return {
        screen: spec.screen,
        viewport: spec.viewport.name,
        scheme: spec.scheme,
        file: spec.file,
        status: "captured",
        sha256: sha256(bytes),
        url: "http://localhost/fixture",
        expectedUrl: "http://localhost/fixture",
        readySelector: "main h1",
        readyText: "Fixture",
        fontsReady: true,
        imagesReady: true,
      };
    }),
  };
  const save = () =>
    writeFileSync(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest),
    );
  save();
  return { directory, manifest, save };
}

test("requires the complete 20 x 3 x 2 matrix", () => {
  assert.equal(expectedCaptures().length, 120);
  const f = fixture("candidate");
  assert.equal(validateManifest(f.directory, "candidate").captures.length, 120);
  f.manifest.captures.pop();
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "candidate"),
    /exactly 120/,
  );
});
test("missing, failed and duplicate captures fail", () => {
  const f = fixture("candidate");
  const first = f.manifest.captures[0];
  first.status = "failed";
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "candidate"),
    /failed capture/,
  );
  first.status = "captured";
  f.manifest.captures[1] = first;
  f.save();
  assert.throws(() => validateManifest(f.directory, "candidate"), /duplicate/);
  f.manifest.captures[1] = {
    ...first,
    file: expectedCaptures()[1].file,
    scheme: "dark",
  };
  f.save();
  rmSync(path.join(f.directory, first.file));
  assert.throws(() => validateManifest(f.directory, "candidate"), /ENOENT/);
});
test("upstream source pin and clean state are mandatory", () => {
  const f = fixture("upstream");
  f.manifest.source.sha = "b".repeat(40);
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "upstream"),
    /clean pinned/,
  );
  f.manifest.source.sha = UPSTREAM_SHA;
  f.manifest.source.dirty = true;
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "upstream"),
    /clean pinned/,
  );
});
test("requires actual file hashes, dimensions, readiness and correct destinations", () => {
  const f = fixture("candidate");
  const first = f.manifest.captures[0];
  first.sha256 = "0".repeat(64);
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "candidate"),
    /hash mismatch/,
  );
  const wrongSize = png(1, 1);
  writeFileSync(path.join(f.directory, first.file), wrongSize);
  first.sha256 = sha256(wrongSize);
  f.save();
  assert.throws(() => validateManifest(f.directory, "candidate"), /dimensions/);
  first.fontsReady = false;
  f.save();
  assert.throws(() => validateManifest(f.directory, "candidate"), /readiness/);
  first.fontsReady = true;
  first.url = "http://localhost/auth/sign-in";
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "candidate"),
    /wrong destination/,
  );
  first.expectedUrl = first.url;
  f.save();
  assert.throws(
    () => validateManifest(f.directory, "candidate"),
    /authentication fallback/,
  );
});
test("failed seed probes and differing logical seed exports fail", () => {
  const a = fixture("upstream");
  const b = fixture("candidate");
  b.manifest.seed.probes[0].passed = false;
  b.save();
  assert.throws(
    () => validatePair(a.directory, b.directory),
    /seed API verification/,
  );
  b.manifest.seed.probes[0].passed = true;
  const other = Buffer.from('{"records":[]}');
  writeFileSync(path.join(b.directory, "seed-export.json"), other);
  b.manifest.seed.sha256 = sha256(other);
  b.save();
  assert.throws(
    () => validatePair(a.directory, b.directory),
    /Seed content differs/,
  );
});
test("render/browser environment differences fail", () => {
  const a = fixture("upstream");
  const b = fixture("candidate");
  b.manifest.render.browserVersion = "other";
  b.save();
  assert.throws(
    () => validatePair(a.directory, b.directory),
    /Render environment differs/,
  );
});
test("source fingerprint includes uncommitted and untracked content", () => {
  const root = temporary();
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(path.join(root, "code"), "before");
  execFileSync("git", ["-C", root, "add", "code"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Unit",
    "-c",
    "user.email=unit@example.test",
    "commit",
    "-qm",
    "fixture",
  ]);
  const initial = sourceIdentity(root);
  assert.equal(initial.dirty, false);
  const a = fixture("upstream");
  const b = fixture("candidate");
  b.manifest.source = initial;
  b.save();
  validatePair(a.directory, b.directory, root);
  writeFileSync(path.join(root, "code"), "after");
  const changed = sourceIdentity(root);
  assert.throws(
    () => validatePair(a.directory, b.directory, root),
    /Candidate capture is stale/,
  );
  assert.notEqual(changed.worktreeSha256, initial.worktreeSha256);
  writeFileSync(path.join(root, "new"), "untracked");
  assert.notEqual(sourceIdentity(root).worktreeSha256, changed.worktreeSha256);
});
test("capture plans refuse missing pairings and generic readiness", () => {
  const plan = {
    version: 1,
    side: "candidate",
    baseUrl: "http://localhost:1337",
    apiUrl: "http://localhost:1337",
    seed: {
      kind: "persisted-api-export",
      file: "seed.json",
      probes: [
        { path: "/api/fixture", pointer: "/title", expected: "Persisted" },
      ],
    },
    storageState: "session.json",
    screens: SCREENS.map((name) => ({
      name,
      path: "/fixture",
      expectedPath: "/fixture",
      readySelector: "main h1",
      readyText: "Persisted",
    })),
  };
  validatePlan(plan);
  plan.screens[0].readySelector = "body";
  assert.throws(() => validatePlan(plan), /Specific content readiness/);
  plan.screens.pop();
  assert.throws(() => validatePlan(plan), /all 20/);
});
test("CLI fails missing baseline without creating one", () => {
  const root = temporary();
  const missing = path.join(root, "missing");
  const result = spawnSync(
    process.execPath,
    [new URL("./check.mjs", import.meta.url).pathname, missing, root],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Kaneo parity failed/);
  assert.throws(
    () => readFileSync(path.join(missing, "manifest.json")),
    /ENOENT/,
  );
});

// These exercise only Playwright's PNG matcher; no page/browser fixture is requested.
test("strict pixel comparison accepts identical PNGs and rejects a one-level colour change", () => {
  const a = fixture("upstream");
  const b = fixture("candidate");
  const run = () => runComparison(a.directory, b.directory, true);
  const same = run();
  assert.equal(same.status, 0, (same.stdout + same.stderr).slice(-8000));
  const first = b.manifest.captures[0];
  const spec = expectedCaptures()[0];
  const changed = png(spec.viewport.width, spec.viewport.height, 1);
  writeFileSync(path.join(b.directory, first.file), changed);
  first.sha256 = sha256(changed);
  b.save();
  const different = run();
  assert.equal(
    different.status,
    1,
    (different.stdout + different.stderr).slice(-8000),
  );
  assert.match(
    different.stdout + different.stderr,
    /Screenshot comparison failed|pixels.*different|Expected an image/,
  );
});

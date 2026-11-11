import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync, zstdCompressSync } from "node:zlib";
import {
  DOCKER_EXTRACT_PACKAGES,
  PLAYWRIGHT_ROOT_PACKAGES,
  verifyUbuntuCiBundle,
} from "./verify-ubuntu-ci-bundle.mjs";

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
function octal(buffer, offset, length, value) {
  buffer.write(
    `${value.toString(8).padStart(length - 1, "0")}\0`,
    offset,
    length,
    "ascii",
  );
}
function tar(entries) {
  const blocks = [];
  for (const { name, data = Buffer.alloc(0), type = "0" } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "ascii");
    octal(header, 100, 8, 0o644);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, data.length);
    octal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    octal(
      header,
      148,
      8,
      header.reduce((sum, byte) => sum + byte, 0),
    );
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
function ar(entries) {
  return Buffer.concat([
    Buffer.from("!<arch>\n"),
    ...entries.flatMap(([name, bytes]) => {
      const header = `${`${name}/`.padEnd(16)}${"0".padEnd(12)}${"0".padEnd(6)}${"0".padEnd(6)}${"100644".padEnd(8)}${String(bytes.length).padEnd(10)}\x60\n`;
      return [
        Buffer.from(header, "ascii"),
        bytes,
        ...(bytes.length % 2 ? [Buffer.from("\n")] : []),
      ];
    }),
  ]);
}
function deb(name, version = "1.2-1", architecture = "amd64") {
  const control = Buffer.from(
    `Package: ${name}\nVersion: ${version}\nArchitecture: ${architecture}\nDescription: test only\n`,
  );
  return ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.gz", gzipSync(tar([{ name: "./control", data: control }]))],
    ["data.tar.gz", gzipSync(tar([]))],
  ]);
}
function setup(t, names = ["docker-buildx", "docker-compose-v2"]) {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "ubuntu-bundle-test-")),
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const packages = names.map((name) => {
    const bytes = deb(name);
    return {
      name,
      version: "1.2-1",
      architecture: "amd64",
      filename: `${name}_1.2-1_amd64.deb`,
      size: bytes.length,
      sha256: sha(bytes),
      bytes,
    };
  });
  const archivePath = path.join(dir, "bundle.tar");
  const manifest = {
    schemaVersion: 1,
    suite: "noble",
    architecture: "amd64",
    archiveSha256: "",
    packages: packages.map(({ bytes, ...item }) => item),
  };
  const pack = (
    entries = packages.map((p) => ({ name: p.filename, data: p.bytes })),
  ) => {
    const bytes = tar(entries);
    writeFileSync(archivePath, bytes);
    manifest.archiveSha256 = sha(bytes);
    return bytes;
  };
  pack();
  const run = (overrides = {}) =>
    verifyUbuntuCiBundle({
      archivePath,
      trustedManifest: manifest,
      destinationParent: dir,
      playwrightRoots: [],
      ...overrides,
    });
  const before = () => readdirSync(dir).sort();
  return { dir, packages, manifest, archivePath, pack, run, before };
}
function rejectedWithoutWrites(f, action, pattern) {
  const before = f.before();
  assert.throws(action, pattern);
  assert.deepEqual(f.before(), before);
}

test("verified pinned bundle materializes exactly the allowlisted DEBs in a private new directory", (t) => {
  const f = setup(t);
  const sentinel = path.join(f.dir, "keep");
  writeFileSync(sentinel, "unchanged");
  const dest = f.run();
  assert.equal(lstatSync(dest).mode & 0o077, 0);
  assert.deepEqual(
    readdirSync(path.join(dest, "debs")).sort(),
    f.packages.map((p) => p.filename).sort(),
  );
  for (const pkg of f.packages)
    assert.deepEqual(
      readFileSync(path.join(dest, "debs", pkg.filename)),
      pkg.bytes,
    );
  assert.equal(readFileSync(sentinel, "utf8"), "unchanged");
});

test("manifest is mandatory, bounded, specific to Noble amd64, and contains unique pinned package identities", (t) => {
  const f = setup(t);
  for (const manifest of [
    undefined,
    {},
    { ...f.manifest, suite: "jammy" },
    { ...f.manifest, architecture: "arm64" },
    { ...f.manifest, archiveSha256: "" },
    { ...f.manifest, archiveSha256: Symbol() },
    { ...f.manifest, packages: [] },
    {
      ...f.manifest,
      packages: [
        { ...f.manifest.packages[0], filename: "docker-buildx_2.0_amd64.deb" },
      ],
    },
    {
      ...f.manifest,
      packages: [f.manifest.packages[0], f.manifest.packages[0]],
    },
    {
      ...f.manifest,
      packages: [{ ...f.manifest.packages[0], architecture: "arm64" }],
    },
    {
      ...f.manifest,
      packages: [{ ...f.manifest.packages[0], architecture: "i386" }],
    },
    {
      ...f.manifest,
      packages: [{ ...f.manifest.packages[0], architecture: "ALL" }],
    },
    { ...f.manifest, extra: true },
  ]) {
    rejectedWithoutWrites(
      f,
      () => f.run({ trustedManifest: manifest }),
      /invalid trusted manifest/,
    );
  }
});

test("archive digest mismatch and symlinked archive are rejected", (t) => {
  const f = setup(t);
  f.manifest.archiveSha256 = "0".repeat(64);
  rejectedWithoutWrites(f, () => f.run(), /archive checksum mismatch/);
  const link = path.join(f.dir, "archive-link");
  symlinkSync(f.archivePath, link);
  rejectedWithoutWrites(
    f,
    () => f.run({ archivePath: link }),
    /invalid archive/,
  );
});

test("missing, extra, duplicate and hash-mismatched DEBs cannot materialize", (t) => {
  const f = setup(t);
  for (const entries of [
    [{ name: f.packages[0].filename, data: f.packages[0].bytes }],
    [
      ...f.packages.map((p) => ({ name: p.filename, data: p.bytes })),
      { name: "extra_1_amd64.deb", data: Buffer.from("extra") },
    ],
    [
      { name: f.packages[0].filename, data: f.packages[0].bytes },
      { name: f.packages[0].filename, data: f.packages[0].bytes },
    ],
    [
      { name: f.packages[0].filename, data: Buffer.alloc(f.packages[0].size) },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ],
  ]) {
    f.pack(entries);
    rejectedWithoutWrites(
      f,
      () => f.run(),
      /invalid archive|package set mismatch/,
    );
  }
});

test("truncated, corrupt and trailing-data tar archives fail even when their digest is pinned", (t) => {
  const f = setup(t);
  const original = f.pack();
  for (const bytes of [
    original.subarray(0, original.length - 512),
    Buffer.concat([original, Buffer.from("x")]),
    Buffer.from(original),
  ]) {
    if (bytes.length === original.length) bytes[0] ^= 1;
    writeFileSync(f.archivePath, bytes);
    f.manifest.archiveSha256 = sha(bytes);
    rejectedWithoutWrites(f, () => f.run(), /invalid archive/);
  }
});

test("tar paths and non-regular members cannot escape or create aliases", (t) => {
  const f = setup(t);
  for (const item of [
    { name: "../escape.deb", type: "0" },
    { name: "/absolute.deb", type: "0" },
    { name: f.packages[0].filename, type: "2" },
    { name: f.packages[0].filename, type: "1" },
    { name: f.packages[0].filename, type: "x" },
  ]) {
    f.pack([
      { ...item, data: Buffer.alloc(0) },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
    rejectedWithoutWrites(f, () => f.run(), /invalid archive/);
  }
});

test("DEB identity, version, architecture and valid control metadata are enforced", (t) => {
  const f = setup(t);
  for (const bytes of [
    deb("other"),
    deb(f.packages[0].name, "2.0"),
    deb(f.packages[0].name, "1.2-1", "arm64"),
    Buffer.from("not a deb"),
  ]) {
    f.manifest.packages[0].size = bytes.length;
    f.manifest.packages[0].sha256 = sha(bytes);
    f.pack([
      { name: f.packages[0].filename, data: bytes },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
    rejectedWithoutWrites(
      f,
      () => f.run(),
      /package metadata mismatch|invalid package/,
    );
  }
});

test("unsafe, symlinked and publicly writable destinations are rejected without touching them", (t) => {
  const f = setup(t);
  const link = path.join(f.dir, "link");
  symlinkSync(f.dir, link);
  rejectedWithoutWrites(
    f,
    () => f.run({ destinationParent: link }),
    /unsafe destination/,
  );
  rejectedWithoutWrites(
    f,
    () => f.run({ destinationParent: "relative" }),
    /unsafe destination/,
  );
  chmodSync(f.dir, 0o755);
  rejectedWithoutWrites(f, () => f.run(), /unsafe destination/);
  chmodSync(f.dir, 0o700);
});

test("zstd-compressed DEB control metadata is verified", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const control = Buffer.from(
    `Package: ${first.name}\nVersion: ${first.version}\nArchitecture: amd64\n`,
  );
  const bytes = ar([
    ["debian-binary", Buffer.from("2.0\n")],
    [
      "control.tar.zst",
      zstdCompressSync(tar([{ name: "./control", data: control }])),
    ],
    ["data.tar.zst", zstdCompressSync(tar([]))],
  ]);
  f.manifest.packages[0].size = bytes.length;
  f.manifest.packages[0].sha256 = sha(bytes);
  f.pack([
    { name: first.filename, data: bytes },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  const destination = f.run();
  assert.deepEqual(
    readFileSync(path.join(destination, "debs", first.filename)),
    bytes,
  );
});

test("duplicate control fields, unsafe control members and oversized decompressed control are rejected", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const controls = [
    tar([
      {
        name: "./control",
        data: Buffer.from(
          `Package: ${first.name}\nPackage: other\nVersion: 1.2-1\nArchitecture: amd64\n`,
        ),
      },
    ]),
    tar([{ name: "../control", data: Buffer.from("unsafe") }]),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  ];
  for (const control of controls) {
    const bytes = ar([
      ["debian-binary", Buffer.from("2.0\n")],
      ["control.tar.gz", gzipSync(control)],
      ["data.tar.gz", gzipSync(tar([]))],
    ]);
    f.manifest.packages[0].size = bytes.length;
    f.manifest.packages[0].sha256 = sha(bytes);
    f.pack([
      { name: first.filename, data: bytes },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
    rejectedWithoutWrites(f, () => f.run(), /invalid archive|invalid package/);
  }
});

test("missing or malformed invocation fails with a fixed diagnostic", () => {
  for (const input of [
    undefined,
    null,
    {},
    {
      archivePath: "a",
      trustedManifest: {},
      destinationParent: "/",
      extra: true,
    },
  ]) {
    assert.throws(
      () => verifyUbuntuCiBundle(input),
      /Ubuntu CI bundle: invalid arguments/,
    );
  }
});

test("missing archive fails locally without creating output", (t) => {
  const f = setup(t);
  rejectedWithoutWrites(
    f,
    () => f.run({ archivePath: path.join(f.dir, "absent") }),
    /invalid archive/,
  );
});

test("a FIFO is rejected without waiting for a writer", (t) => {
  const f = setup(t);
  const fifo = path.join(f.dir, "fifo");
  assert.equal(spawnSync("/usr/bin/mkfifo", [fifo]).status, 0);
  rejectedWithoutWrites(
    f,
    () => f.run({ archivePath: fifo }),
    /invalid archive/,
  );
});

test("truncated DEB members and non-ASCII archive magic are rejected", (t) => {
  const f = setup(t);
  const original = f.packages[0].bytes;
  const corrupted = Buffer.from(original);
  corrupted[0] |= 0x80;
  for (const bytes of [original.subarray(0, original.length - 1), corrupted]) {
    f.manifest.packages[0].size = bytes.length;
    f.manifest.packages[0].sha256 = sha(bytes);
    f.pack([
      { name: f.packages[0].filename, data: bytes },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
    rejectedWithoutWrites(f, () => f.run(), /invalid package/);
  }
});

test("percent-encoded epoch filenames still bind the exact DEB version", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const bytes = deb(first.name, "1:1.2-1");
  f.manifest.packages[0] = {
    ...f.manifest.packages[0],
    version: "1:1.2-1",
    filename: `${first.name}_1%3a1.2-1_amd64.deb`,
    size: bytes.length,
    sha256: sha(bytes),
  };
  f.pack([
    { name: f.manifest.packages[0].filename, data: bytes },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  const dest = f.run();
  assert.deepEqual(
    readFileSync(path.join(dest, "debs", f.manifest.packages[0].filename)),
    bytes,
  );
});

test("architecture-independent packages are accepted only with matching manifest and DEB metadata", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const bytes = deb(first.name, first.version, "all");
  f.manifest.packages[0] = {
    ...f.manifest.packages[0],
    architecture: "all",
    filename: `${first.name}_${first.version}_all.deb`,
    size: bytes.length,
    sha256: sha(bytes),
  };
  f.pack([
    { name: f.manifest.packages[0].filename, data: bytes },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  const dest = f.run();
  assert.deepEqual(
    readFileSync(path.join(dest, "debs", f.manifest.packages[0].filename)),
    bytes,
  );
  const mismatched = deb(first.name, first.version, "amd64");
  f.manifest.packages[0].size = mismatched.length;
  f.manifest.packages[0].sha256 = sha(mismatched);
  f.pack([
    { name: f.manifest.packages[0].filename, data: mismatched },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  rejectedWithoutWrites(f, () => f.run(), /package metadata mismatch/);
});

test("oversized zstd control output is rejected before writing", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const bytes = ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.zst", zstdCompressSync(Buffer.alloc(8 * 1024 * 1024 + 1))],
    ["data.tar.zst", zstdCompressSync(tar([]))],
  ]);
  f.manifest.packages[0].size = bytes.length;
  f.manifest.packages[0].sha256 = sha(bytes);
  f.pack([
    { name: first.filename, data: bytes },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  rejectedWithoutWrites(f, () => f.run(), /invalid package/);
});

test("xz-compressed DEB control metadata is verified through the fixed xz binary", (t) => {
  const xzPath = [
    "/usr/bin/xz",
    "/opt/homebrew/bin/xz",
    "/usr/local/bin/xz",
  ].find((candidate) => existsSync(candidate));
  if (!xzPath) return t.skip("xz unavailable");
  const f = setup(t);
  const first = f.packages[0];
  const control = Buffer.from(
    `Package: ${first.name}\nVersion: ${first.version}\nArchitecture: amd64\n`,
  );
  const compress = (input) => spawnSync(xzPath, ["--stdout"], { input }).stdout;
  const bytes = ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.xz", compress(tar([{ name: "./control", data: control }]))],
    ["data.tar.xz", compress(tar([]))],
  ]);
  f.manifest.packages[0].size = bytes.length;
  f.manifest.packages[0].sha256 = sha(bytes);
  f.pack([
    { name: first.filename, data: bytes },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  assert.ok(f.run());
  const goodControl = compress(tar([{ name: "./control", data: control }]));
  const corrupt = ar([
    ["debian-binary", Buffer.from("2.0\n")],
    ["control.tar.xz", goodControl.subarray(0, goodControl.length - 16)],
    ["data.tar.xz", compress(tar([]))],
  ]);
  f.manifest.packages[0].size = corrupt.length;
  f.manifest.packages[0].sha256 = sha(corrupt);
  f.pack([
    { name: first.filename, data: corrupt },
    { name: f.packages[1].filename, data: f.packages[1].bytes },
  ]);
  rejectedWithoutWrites(f, () => f.run(), /invalid package/);
});

test("verifier has no network or workflow wiring", () => {
  const source = readFileSync(
    new URL("./verify-ubuntu-ci-bundle.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /node:(https?|net|tls|dns|dgram|http2)|fetch\(|curl|apt-get/,
  );
});

test("CLI prints only the new directory on success and one fixed line on failure", (t) => {
  const f = setup(t, [...DOCKER_EXTRACT_PACKAGES, ...PLAYWRIGHT_ROOT_PACKAGES]);
  const manifestPath = path.join(f.dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(f.manifest));
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [
        new URL("./verify-ubuntu-ci-bundle.mjs", import.meta.url).pathname,
        ...args,
      ],
      { encoding: "utf8" },
    );
  const good = cli(
    "--archive",
    f.archivePath,
    "--manifest",
    manifestPath,
    "--destination-parent",
    f.dir,
  );
  assert.equal(good.status, 0);
  assert.equal(good.stderr, "");
  const printed = good.stdout.trimEnd();
  assert.equal(path.dirname(printed), f.dir);
  assert.equal(readdirSync(path.join(printed, "debs")).length, 35);
  for (const args of [
    [],
    ["--archive", f.archivePath],
    [
      "--manifest",
      manifestPath,
      "--archive",
      f.archivePath,
      "--destination-parent",
      f.dir,
    ],
    [
      "--archive",
      path.join(f.dir, "absent"),
      "--manifest",
      manifestPath,
      "--destination-parent",
      f.dir,
    ],
    [
      "--archive",
      f.archivePath,
      "--manifest",
      path.join(f.dir, "absent"),
      "--destination-parent",
      f.dir,
    ],
  ]) {
    const before = f.before();
    const bad = cli(...args);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /^Ubuntu CI bundle: [a-z ]+\n$/);
    assert.deepEqual(f.before(), before);
  }
});

test("non-UTF-8 description bytes are tolerated while identity fields stay strict", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const make = (control) => {
    const bytes = ar([
      ["debian-binary", Buffer.from("2.0\n")],
      ["control.tar.gz", gzipSync(tar([{ name: "./control", data: control }]))],
      ["data.tar.gz", gzipSync(tar([]))],
    ]);
    f.manifest.packages[0].size = bytes.length;
    f.manifest.packages[0].sha256 = sha(bytes);
    f.pack([
      { name: first.filename, data: bytes },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
  };
  const head = `Package: ${first.name}\nVersion: ${first.version}\nArchitecture: amd64\n`;
  make(
    Buffer.concat([
      Buffer.from(head),
      Buffer.from("Description: caf\xe9 \xff\n", "latin1"),
    ]),
  );
  assert.ok(f.run());
  make(Buffer.from(`${head}Description: nul\0\n`));
  rejectedWithoutWrites(f, () => f.run(), /invalid package/);
  make(Buffer.from(`Package: ${first.name}\nVersion: \nArchitecture: amd64\n`));
  rejectedWithoutWrites(f, () => f.run(), /invalid package/);
});

test("materialization builds a flat local APT repository, docker extraction set and exact roots list", (t) => {
  const names = ["libroot-a", "libroot-b", "libdep"];
  const f = setup(t, [...DOCKER_EXTRACT_PACKAGES, ...names]);
  const dest = f.run({ playwrightRoots: ["libroot-b", "libroot-a"] });
  assert.deepEqual(readdirSync(path.join(dest, "docker-debs")).sort(), [
    "docker-buildx_1.2-1_amd64.deb",
    "docker-compose-v2_1.2-1_amd64.deb",
  ]);
  assert.deepEqual(
    readdirSync(path.join(dest, "apt-repo")).sort(),
    ["Packages", ...names.map((n) => `${n}_1.2-1_amd64.deb`)].sort(),
  );
  assert.equal(readdirSync(path.join(dest, "debs")).length, 5);
  assert.equal(
    readFileSync(path.join(dest, "playwright-roots.txt"), "utf8"),
    "libroot-b\nlibroot-a\n",
  );
  const packages = readFileSync(
    path.join(dest, "apt-repo", "Packages"),
    "utf8",
  );
  const stanzas = packages.split("\n\n").filter(Boolean);
  assert.equal(stanzas.length, 3);
  assert.deepEqual(
    stanzas.map((x) => /^Package: (.+)$/m.exec(x)[1]),
    ["libdep", "libroot-a", "libroot-b"],
  );
  for (const stanza of stanzas) {
    const name = /^Package: (.+)$/m.exec(stanza)[1];
    const pkg = f.packages.find((p) => p.name === name);
    assert.match(
      stanza,
      new RegExp(
        `\\nFilename: \\./${pkg.filename}\\nSize: ${pkg.size}\\nSHA256: ${pkg.sha256}$`,
      ),
    );
    assert.equal((stanza.match(/^Filename:/gm) ?? []).length, 1);
  }
  assert.ok(packages.endsWith("\n\n"));
  assert.equal(lstatSync(path.join(dest, "apt-repo")).mode & 0o077, 0);
});

test("unknown, duplicate, Docker or missing roots are rejected", (t) => {
  const f = setup(t);
  for (const roots of [
    ["absent"],
    ["docker-buildx"],
    [f.packages[0].name, f.packages[0].name],
  ])
    rejectedWithoutWrites(
      f,
      () => f.run({ playwrightRoots: roots }),
      /package set mismatch/,
    );
  rejectedWithoutWrites(
    f,
    () => f.run({ playwrightRoots: undefined }),
    /package set mismatch/,
  );
});

test("DEB control files cannot inject Filename, Size or SHA256 fields or blank-line stanzas", (t) => {
  const f = setup(t);
  const first = f.packages[0];
  const head = `Package: ${first.name}\nVersion: ${first.version}\nArchitecture: amd64\n`;
  for (const extra of [
    "Filename: ./evil.deb\n",
    "Size: 1\n",
    "SHA256: x\n",
    "MD5sum: x\n",
    "\nPackage: other\n",
  ]) {
    const bytes = ar([
      ["debian-binary", Buffer.from("2.0\n")],
      [
        "control.tar.gz",
        gzipSync(tar([{ name: "./control", data: Buffer.from(head + extra) }])),
      ],
      ["data.tar.gz", gzipSync(tar([]))],
    ]);
    f.manifest.packages[0].size = bytes.length;
    f.manifest.packages[0].sha256 = sha(bytes);
    f.pack([
      { name: first.filename, data: bytes },
      { name: f.packages[1].filename, data: f.packages[1].bytes },
    ]);
    rejectedWithoutWrites(f, () => f.run(), /invalid package/);
  }
});

test("tar members need ustar magic and an empty link name", (t) => {
  const f = setup(t);
  const archive = readFileSync(f.archivePath);
  const mutate = (offset, bytes) => {
    const copy = Buffer.from(archive);
    bytes.copy(copy, offset);
    const sum = copy
      .subarray(0, 512)
      .reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    copy.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    writeFileSync(f.archivePath, copy);
    f.manifest.archiveSha256 = sha(copy);
  };
  mutate(257, Buffer.from("notustar"));
  rejectedWithoutWrites(f, () => f.run(), /invalid archive/);
  mutate(257, Buffer.from("ustar\x0000"));
  mutate(157, Buffer.from("target"));
  rejectedWithoutWrites(f, () => f.run(), /invalid archive/);
});

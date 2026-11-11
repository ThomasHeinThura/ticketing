// Offline verifier only. The manifest MUST come from a reviewed, trusted source;
// a manifest supplied with the archive cannot authenticate that archive.
// No workflow calls this module until the real manifest and bundle are reviewed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, zstdDecompressSync } from "node:zlib";

// Playwright 1.63.0 ubuntu24.04-x64 Chromium dependency roots (single source of truth).
export const PLAYWRIGHT_ROOT_PACKAGES = Object.freeze(
  "xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2".split(
    " ",
  ),
);
export const DOCKER_EXTRACT_PACKAGES = Object.freeze([
  "docker-buildx",
  "docker-compose-v2",
]);
const MAX_BUNDLE = 512 * 1024 * 1024;
const MAX_CONTROL = 8 * 1024 * 1024;
const MAX_PACKAGES = 1024;
const HASH = /^[a-f0-9]{64}$/;
const PACKAGE = /^[a-z0-9][a-z0-9+.-]+$/;
const VERSION = /^[0-9][A-Za-z0-9.+:~-]*$/;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9.+_~%-]*\.deb$/;

const XZ_PATHS = ["/usr/bin/xz", "/opt/homebrew/bin/xz", "/usr/local/bin/xz"];
// Fixed absolute allowlist; never search the mutable PATH.
function trustedXz() {
  for (const candidate of XZ_PATHS) {
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {}
  }
  return fail("missing xz");
}

const fail = (message) => {
  throw new Error(`Ubuntu CI bundle: ${message}`);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

function validateManifest(manifest) {
  if (
    !exactKeys(manifest, [
      "schemaVersion",
      "suite",
      "architecture",
      "archiveSha256",
      "packages",
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.suite !== "noble" ||
    manifest.architecture !== "amd64" ||
    typeof manifest.archiveSha256 !== "string" ||
    !HASH.test(manifest.archiveSha256) ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0 ||
    manifest.packages.length > MAX_PACKAGES
  )
    fail("invalid trusted manifest");
  const names = new Set();
  const filenames = new Set();
  for (const pkg of manifest.packages) {
    if (
      !exactKeys(pkg, [
        "name",
        "version",
        "architecture",
        "filename",
        "size",
        "sha256",
      ]) ||
      typeof pkg.name !== "string" ||
      !PACKAGE.test(pkg.name) ||
      typeof pkg.version !== "string" ||
      !VERSION.test(pkg.version) ||
      (pkg.architecture !== "amd64" && pkg.architecture !== "all") ||
      typeof pkg.filename !== "string" ||
      !FILENAME.test(pkg.filename) ||
      !pkg.filename.startsWith(`${pkg.name}_`) ||
      !Number.isSafeInteger(pkg.size) ||
      pkg.size <= 0 ||
      pkg.size > MAX_BUNDLE ||
      typeof pkg.sha256 !== "string" ||
      !HASH.test(pkg.sha256) ||
      names.has(pkg.name) ||
      filenames.has(pkg.filename)
    )
      fail("invalid trusted manifest");
    const suffix = `_${pkg.architecture}.deb`;
    try {
      if (
        !pkg.filename.endsWith(suffix) ||
        decodeURIComponent(
          pkg.filename.slice(pkg.name.length + 1, -suffix.length),
        ) !== pkg.version
      )
        fail("invalid trusted manifest");
    } catch {
      fail("invalid trusted manifest");
    }
    names.add(pkg.name);
    filenames.add(pkg.filename);
  }
}

function octal(bytes) {
  if (bytes.some((b) => b > 127)) fail("invalid archive");
  const text = bytes.toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]+$/.test(text)) fail("invalid archive");
  const n = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(n)) fail("invalid archive");
  return n;
}

function field(bytes) {
  const zero = bytes.indexOf(0);
  const part = zero < 0 ? bytes : bytes.subarray(0, zero);
  if (zero >= 0 && bytes.subarray(zero).some((b) => b !== 0))
    fail("invalid archive");
  if (part.some((b) => b < 32 || b > 126)) fail("invalid archive");
  return part.toString("ascii");
}

// A strict ustar subset: no links, extensions, absolute names, traversal or
// duplicate entries. Metadata and data are checked before any file is written.
function tarEntries(bytes, control = false) {
  if (bytes.length % 512 !== 0) fail("invalid archive");
  const entries = new Map();
  let pos = 0;
  while (pos + 512 <= bytes.length) {
    const header = bytes.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) {
      if (
        pos + 1024 > bytes.length ||
        !bytes.subarray(pos).every((b) => b === 0)
      )
        fail("invalid archive");
      return entries;
    }
    const sum = header.reduce(
      (a, b, i) => a + (i >= 148 && i < 156 ? 32 : b),
      0,
    );
    if (
      octal(header.subarray(148, 156)) !== sum ||
      !(
        header.subarray(257, 265).equals(Buffer.from("ustar\x0000")) ||
        header.subarray(257, 265).equals(Buffer.from("ustar  \0"))
      ) ||
      field(header.subarray(157, 257)) !== "" ||
      field(header.subarray(345, 500)) !== ""
    )
      fail("invalid archive");
    let name = field(header.subarray(0, 100));
    if (control && name.startsWith("./")) name = name.slice(2);
    const type = header[156];
    const size = octal(header.subarray(124, 136));
    const directory = type === 53;
    if (
      (!control && !FILENAME.test(name)) ||
      (control && name === "" && !directory) ||
      (control && name !== "" && !/^[A-Za-z0-9_.+\-/]+\/?$/.test(name)) ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      !(type === 0 || type === 48 || (control && directory)) ||
      (directory && size !== 0) ||
      entries.has(name)
    )
      fail("invalid archive");
    pos += 512;
    const padded = Math.ceil(size / 512) * 512;
    if (
      size > bytes.length - pos ||
      padded > bytes.length - pos ||
      !bytes.subarray(pos + size, pos + padded).every((b) => b === 0)
    )
      fail("invalid archive");
    entries.set(name, { directory, bytes: bytes.subarray(pos, pos + size) });
    pos += padded;
  }
  fail("invalid archive");
}

function debMetadata(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from("!<arch>\n")))
    fail("invalid package");
  let pos = 8;
  const entries = new Map();
  while (pos < bytes.length) {
    if (pos + 60 > bytes.length) fail("invalid package");
    const header = bytes.subarray(pos, pos + 60);
    if (
      header.some((b) => b > 127) ||
      header.subarray(58, 60).toString("ascii") !== "`\n"
    )
      fail("invalid package");
    const name = header
      .subarray(0, 16)
      .toString("ascii")
      .trim()
      .replace(/\/$/, "");
    const sizeText = header.subarray(48, 58).toString("ascii").trim();
    if (!/^[0-9]+$/.test(sizeText) || entries.has(name))
      fail("invalid package");
    const size = Number(sizeText);
    pos += 60;
    if (!Number.isSafeInteger(size) || size > bytes.length - pos)
      fail("invalid package");
    entries.set(name, bytes.subarray(pos, pos + size));
    pos += size;
    if (size % 2) {
      if (bytes[pos] !== 10) fail("invalid package");
      pos++;
    }
  }
  const controls = [...entries.keys()].filter((n) =>
    /^control\.tar\.(gz|zst|xz)$/.test(n),
  );
  const data = [...entries.keys()].filter((n) =>
    /^data\.tar\.(gz|zst|xz)$/.test(n),
  );
  if (
    entries.size !== 3 ||
    !entries.get("debian-binary")?.equals(Buffer.from("2.0\n")) ||
    controls.length !== 1 ||
    data.length !== 1
  )
    fail("invalid package");
  const name = controls[0];
  let controlTar;
  try {
    if (name.endsWith(".gz"))
      controlTar = gunzipSync(entries.get(name), {
        maxOutputLength: MAX_CONTROL,
      });
    else if (name.endsWith(".zst"))
      controlTar = zstdDecompressSync(entries.get(name), {
        maxOutputLength: MAX_CONTROL,
      });
    else {
      const result = spawnSync(trustedXz(), ["--decompress", "--stdout"], {
        input: entries.get(name),
        maxBuffer: MAX_CONTROL,
        timeout: 10000,
        killSignal: "SIGKILL",
      });
      if (result.status !== 0 || result.error) fail("invalid package");
      controlTar = result.stdout;
    }
  } catch {
    fail("invalid package");
  }
  const control = tarEntries(controlTar, true).get("control");
  if (!control || control.directory || control.bytes.length > MAX_CONTROL)
    fail("invalid package");
  // Descriptions may hold non-UTF-8 bytes; latin1 decodes losslessly and only
  // the ASCII identity fields are compared.
  const text = control.bytes.toString("latin1");
  if (text.includes("\0")) fail("invalid package");
  const fields = new Map();
  for (const line of text.split("\n")) {
    if (line === "" || /^[ \t]/.test(line)) continue;
    const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
    if (!match || fields.has(match[1].toLowerCase())) fail("invalid package");
    fields.set(match[1].toLowerCase(), match[2]);
  }
  // The local APT index is generated from this stanza plus our own
  // Filename/Size/SHA256 fields, so the package may not carry them.
  if (
    ["filename", "size", "sha256", "md5sum", "sha1", "sha512"].some((key) =>
      fields.has(key),
    ) ||
    /\n[ \t]*\n/.test(text.replace(/\n+$/, ""))
  )
    fail("invalid package");
  const identity = ["package", "version", "architecture"].map((key) =>
    fields.get(key),
  );
  if (identity.some((value) => !/^[\x21-\x7e]+$/.test(value ?? "")))
    fail("invalid package");
  return {
    name: identity[0],
    version: identity[1],
    architecture: identity[2],
    control: control.bytes,
  };
}

function readArchive(archivePath) {
  let fd;
  try {
    fd = openSync(
      archivePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BUNDLE)
      fail("invalid archive");
    const bytes = readFileSync(fd);
    if (bytes.length !== info.size) fail("invalid archive");
    return bytes;
  } catch {
    fail("invalid archive");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Returns a new private directory; destinationParent must be an existing private,
// canonical directory owned by this user, so no existing files are replaced.
export function verifyUbuntuCiBundle(input) {
  const base = ["archivePath", "trustedManifest", "destinationParent"];
  if (
    !exactKeys(input, base) &&
    !exactKeys(input, [...base, "playwrightRoots"])
  )
    fail("invalid arguments");
  const { archivePath, trustedManifest, destinationParent } = input;
  // Overridable only so synthetic fixtures need not carry the real 33 roots.
  const roots = input.playwrightRoots ?? PLAYWRIGHT_ROOT_PACKAGES;
  validateManifest(trustedManifest);
  const manifestNames = new Set(trustedManifest.packages.map((p) => p.name));
  if (
    !Array.isArray(roots) ||
    new Set(roots).size !== roots.length ||
    roots.some(
      (name) =>
        !manifestNames.has(name) || DOCKER_EXTRACT_PACKAGES.includes(name),
    ) ||
    DOCKER_EXTRACT_PACKAGES.some((name) => !manifestNames.has(name))
  )
    fail("package set mismatch");
  const archive = readArchive(archivePath);
  if (digest(archive) !== trustedManifest.archiveSha256)
    fail("archive checksum mismatch");
  const files = tarEntries(archive);
  if (files.size !== trustedManifest.packages.length)
    fail("package set mismatch");
  const controls = new Map();
  for (const pkg of trustedManifest.packages) {
    const file = files.get(pkg.filename);
    if (
      !file ||
      file.bytes.length !== pkg.size ||
      digest(file.bytes) !== pkg.sha256
    )
      fail("package set mismatch");
    const metadata = debMetadata(file.bytes);
    controls.set(pkg.filename, metadata.control);
    if (
      metadata.name !== pkg.name ||
      metadata.version !== pkg.version ||
      metadata.architecture !== pkg.architecture
    )
      fail("package metadata mismatch");
  }
  try {
    if (
      !path.isAbsolute(destinationParent) ||
      realpathSync(destinationParent) !== destinationParent
    )
      fail("unsafe destination");
    const parent = lstatSync(destinationParent);
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== process.getuid() ||
      (parent.mode & 0o077) !== 0
    )
      fail("unsafe destination");
  } catch {
    fail("unsafe destination");
  }
  let destination;
  try {
    destination = mkdtempSync(
      path.join(destinationParent, "ubuntu-ci-bundle-"),
    );
    const subdirs = ["debs", "docker-debs", "apt-repo"];
    for (const dir of subdirs)
      mkdirSync(path.join(destination, dir), { mode: 0o700 });
    const writeNew = (target, bytes) => {
      const fd = openSync(
        target,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, bytes);
      } finally {
        closeSync(fd);
      }
    };
    const ordered = [...trustedManifest.packages].sort((a, b) =>
      a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
    );
    const stanzas = [];
    for (const pkg of ordered) {
      const bytes = files.get(pkg.filename).bytes;
      const docker = DOCKER_EXTRACT_PACKAGES.includes(pkg.name);
      const primary = path.join(
        destination,
        docker ? "docker-debs" : "apt-repo",
        pkg.filename,
      );
      writeNew(primary, bytes);
      // Same inode: no second copy of a large DEB on disk.
      linkSync(primary, path.join(destination, "debs", pkg.filename));
      if (!docker) {
        let control = controls.get(pkg.filename);
        while (control.length && control[control.length - 1] === 10)
          control = control.subarray(0, control.length - 1);
        stanzas.push(
          Buffer.concat([
            control,
            Buffer.from(
              `\nFilename: ./${pkg.filename}\nSize: ${pkg.size}\nSHA256: ${pkg.sha256}\n\n`,
            ),
          ]),
        );
      }
    }
    writeNew(
      path.join(destination, "apt-repo", "Packages"),
      Buffer.concat(stanzas),
    );
    writeNew(
      path.join(destination, "playwright-roots.txt"),
      roots.length ? `${roots.join("\n")}\n` : "",
    );
    return destination;
  } catch {
    if (destination) rmSync(destination, { recursive: true, force: true });
    fail("cannot materialize bundle");
  }
}

// CLI: node verify-ubuntu-ci-bundle.mjs --archive A --manifest M --destination-parent D
// Prints only the new directory on success; any failure prints one fixed line.
function cli(argv) {
  const flags = ["--archive", "--manifest", "--destination-parent"];
  if (argv.length !== 6 || flags.some((flag, i) => argv[i * 2] !== flag))
    fail("invalid arguments");
  let trustedManifest;
  try {
    const info = lstatSync(argv[3]);
    if (!info.isFile() || info.size > MAX_CONTROL)
      fail("invalid trusted manifest");
    trustedManifest = JSON.parse(readFileSync(argv[3], "utf8"));
  } catch {
    fail("invalid trusted manifest");
  }
  return verifyUbuntuCiBundle({
    archivePath: path.resolve(argv[1]),
    trustedManifest,
    destinationParent: path.resolve(argv[5]),
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(`${cli(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(
      `${String(error?.message).startsWith("Ubuntu CI bundle: ") ? error.message : "Ubuntu CI bundle: failed"}\n`,
    );
    process.exit(1);
  }
}

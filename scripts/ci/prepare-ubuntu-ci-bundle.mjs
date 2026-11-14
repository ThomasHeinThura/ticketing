// Prepare a private review candidate from authenticated Ubuntu archive data.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCKER_EXTRACT_PACKAGES,
  PLAYWRIGHT_ROOT_PACKAGES,
} from "./verify-ubuntu-ci-bundle.mjs";

const SIGNING_FINGERPRINT = "F6ECB3762474EDA9D21B7022871920D1991BC93C";
const MAX = 512 * 1024 * 1024;
const ROOTS = PLAYWRIGHT_ROOT_PACKAGES;
const DOCKER = DOCKER_EXTRACT_PACKAGES;
const hash = (b) => createHash("sha256").update(b).digest("hex");
const fail = (m) => {
  throw new Error(`Preparation: ${m}`);
};
function regular(p, max = MAX) {
  const s = lstatSync(p);
  if (!s.isFile() || s.isSymbolicLink() || s.size <= 0 || s.size > max)
    fail(`invalid file ${p}`);
  const b = readFileSync(p);
  if (b.length !== s.size) fail(`changed file ${p}`);
  return b;
}
// Fixed absolute allowlists; never search the mutable PATH.
const TOOLS = {
  gpgv: ["/usr/bin/gpgv", "/opt/homebrew/bin/gpgv", "/usr/local/bin/gpgv"],
  xz: ["/usr/bin/xz", "/opt/homebrew/bin/xz", "/usr/local/bin/xz"],
};
function tool(name) {
  for (const candidate of TOOLS[name]) {
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {}
  }
  return fail(`missing ${name}`);
}
function run(program, args, maxBuffer = 1024 * 1024) {
  const r = spawnSync(tool(program), args, { encoding: "buffer", maxBuffer });
  if (r.error || r.status !== 0) fail(`${program} failed`);
  return r.stdout;
}
export function verifySignature(
  status,
  signingFingerprint = SIGNING_FINGERPRINT,
) {
  const matches = status
    .split("\n")
    .filter((s) => s.startsWith("[GNUPG:] VALIDSIG "));
  if (
    matches.length !== 1 ||
    matches[0].split(" ")[2] !== signingFingerprint ||
    matches[0].split(" ").at(-1) !== signingFingerprint ||
    /\[GNUPG:\] (?:BADSIG|ERRSIG|EXPSIG|EXPKEYSIG|REVKEYSIG)/.test(status)
  )
    fail("signature");
}
export function fields(text) {
  const out = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const m = /^([A-Za-z0-9-]+):(?: (.*))?$/.exec(line);
    if (!m || Object.hasOwn(out, m[1]))
      fail(`malformed or duplicate field: ${line}`);
    out[m[1]] = m[2] ?? "";
  }
  return out;
}
export function indexRecord(text, filename) {
  const section =
    /\nSHA256:\n([\s\S]*?)(?=\n[A-Za-z][A-Za-z0-9-]*:|\n-----BEGIN PGP SIGNATURE-----|\s*$)/.exec(
      text,
    );
  if (!section) fail("missing SHA256 section");
  const matches = section[1]
    .split("\n")
    .map((s) => /^ ([a-f0-9]{64})\s+(\d+)\s+(\S+)$/.exec(s))
    .filter((m) => m?.[3] === filename);
  if (matches.length !== 1) fail("missing or duplicate index");
  return { sha256: matches[0][1], size: Number(matches[0][2]) };
}
export function matchBytes(bytes, expected) {
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size !== bytes.length ||
    expected.sha256 !== hash(bytes)
  )
    fail("size or hash mismatch");
}
export function parsePlan(text) {
  const m = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("Inst ")) continue;
    const a = /^Inst ([a-z0-9][a-z0-9+.-]+) \((\S+) /.exec(line);
    if (!a || m.has(a[1])) fail("invalid plan");
    m.set(a[1], a[2]);
  }
  if (m.size !== 148) fail("plan count");
  return m;
}
function octal(n, width) {
  const s = n.toString(8);
  if (s.length > width - 1) fail("tar field overflow");
  return `${s.padStart(width - 1, "0")}\0`;
}
export function tar(entries) {
  const chunks = [];
  let total = 1024;
  let previous = "";
  for (const [name, data] of entries) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9.+_~%-]*\.deb$/.test(name) ||
      name.length > 100 ||
      name <= previous ||
      !Buffer.isBuffer(data)
    )
      fail("tar entry");
    previous = name;
    const h = Buffer.alloc(512);
    h.write(name, 0, "ascii");
    h.write(octal(0o644, 8), 100);
    h.write(octal(0, 8), 108);
    h.write(octal(0, 8), 116);
    h.write(octal(data.length, 12), 124);
    h.write(octal(0, 12), 136);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write("ustar\0", 257);
    h.write("00", 263);
    const checksum = h.reduce((a, b) => a + b, 0);
    h.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
    total += 512 + data.length + padding.length;
    if (total > MAX) fail("archive too large");
    chunks.push(h, data, padding);
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
const ARMOR_BEGIN = "-----BEGIN PGP SIGNED MESSAGE-----";
const ARMOR_END = "-----END PGP SIGNATURE-----";
// Returns the gpgv-authenticated plaintext only; the raw file is never parsed.
export function verifiedRelease(releasePath, keyring, suite, options = {}) {
  const {
    nowMs = Date.now(),
    maxPocketAgeDays = 30,
    key = SIGNING_FINGERPRINT,
  } = options;
  const raw = regular(releasePath, 4 * 1024 * 1024).toString("utf8");
  if (
    !raw.startsWith(`${ARMOR_BEGIN}\n`) ||
    !raw.trimEnd().endsWith(ARMOR_END) ||
    raw.split(ARMOR_BEGIN).length !== 2 ||
    raw.split(ARMOR_END).length !== 2
  )
    fail("malformed release metadata");
  const scratch = mkdtempSync(path.join(realpathSync(os.tmpdir()), "release-"));
  try {
    const output = path.join(scratch, "release");
    verifySignature(
      run("gpgv", [
        "--status-fd",
        "1",
        "--keyring",
        keyring,
        "--output",
        output,
        releasePath,
      ]).toString(),
      key,
    );
    // Some gpgv releases (2.5.x) leave the verified plaintext as <output>.part.
    const written = [output, `${output}.part`].filter((n) => {
      try {
        lstatSync(n);
        return true;
      } catch {
        return false;
      }
    });
    if (written.length !== 1) fail("malformed release metadata");
    const text = regular(written[0], 4 * 1024 * 1024).toString("utf8");
    const originIdx = text.indexOf("Origin:");
    const md5Idx = text.indexOf("\nMD5Sum:");
    if (originIdx !== 0 || md5Idx <= originIdx || text.includes(ARMOR_BEGIN))
      fail("malformed release metadata");
    const f = fields(text.slice(originIdx, md5Idx));
    const date = Date.parse(f.Date);
    if (
      f.Origin !== "Ubuntu" ||
      f.Suite !== suite ||
      f.Codename !== "noble" ||
      !Number.isFinite(date) ||
      date > nowMs + 86400000
    )
      fail("release identity or date");
    if (suite !== "noble" && date < nowMs - maxPocketAgeDays * 86400000)
      fail("stale release metadata");
    return { text, date: f.Date, sha256: hash(readFileSync(releasePath)) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
export function prepare(dir, options = {}) {
  for (const sub of ["debs", "indexes"]) {
    const s = lstatSync(path.join(dir, sub));
    if (!s.isDirectory() || s.isSymbolicLink()) fail("invalid directory");
  }
  const keyring = path.join(dir, "keyring.gpg");
  const keyBytes = regular(keyring, 1024 * 1024);
  const sources = {};
  const records = new Map();
  const suites = ["noble", "noble-updates", "noble-security"];
  // Authenticate every release before touching any index.
  const releases = Object.fromEntries(
    suites.map((suite) => [
      suite,
      verifiedRelease(
        path.join(dir, `${suite}.InRelease`),
        keyring,
        suite,
        options,
      ),
    ]),
  );
  for (const suite of suites) {
    const rel = releases[suite];
    const text = rel.text;
    sources[suite] = { sha256: rel.sha256, date: rel.date, indexes: {} };
    for (const component of ["main", "universe"]) {
      const idx = `${component}/binary-amd64/Packages.xz`;
      const bytes = regular(
        path.join(dir, "indexes", `${suite}-${component}.Packages.xz`),
      );
      matchBytes(bytes, indexRecord(text, idx));
      sources[suite].indexes[component] = hash(bytes);
      const decompressed = run(
        "xz",
        ["-dc", path.join(dir, "indexes", `${suite}-${component}.Packages.xz`)],
        MAX,
      ).toString("utf8");
      for (const stanza of decompressed.split("\n\n")) {
        if (!stanza.trim()) continue;
        const f = fields(stanza);
        if (
          !f.Package ||
          !f.Version ||
          !f.Architecture ||
          !f.Filename ||
          !f.Size ||
          !f.SHA256
        )
          continue;
        const base = `${f.Package}_${f.Version.replaceAll(":", "%3a")}_${f.Architecture}.deb`;
        const list = records.get(base) || [];
        list.push({
          name: f.Package,
          version: f.Version,
          architecture: f.Architecture,
          filename: base,
          size: Number(f.Size),
          sha256: f.SHA256,
          suite,
          component,
          sourcePath: f.Filename,
        });
        records.set(base, list);
      }
    }
  }
  const plan = parsePlan(
    regular(path.join(dir, "plan.txt"), 1024 * 1024).toString(),
  );
  const allEntries = readdirSync(path.join(dir, "debs"));
  for (const n of allEntries.filter((n) => !n.endsWith(".deb"))) {
    const p = path.join(dir, "debs", n);
    const st = lstatSync(p);
    if (
      st.isSymbolicLink() ||
      !(
        (n === "lock" && st.isFile() && st.size === 0) ||
        (n === "partial" && st.isDirectory() && readdirSync(p).length === 0)
      )
    )
      fail("unexpected package directory entry");
  }
  const filenames = allEntries.filter((n) => n.endsWith(".deb")).sort();
  if (filenames.length !== 150) fail("package count");
  const packages = [];
  const provenance = [];
  const entries = [];
  const seen = new Set();
  for (const filename of filenames) {
    const data = regular(path.join(dir, "debs", filename));
    const matches = (records.get(filename) || []).filter(
      (r) => r.size === data.length && r.sha256 === hash(data),
    );
    if (!matches.length) fail(`no authenticated package record ${filename}`);
    const first = matches[0];
    if (
      matches.some((r) =>
        ["name", "version", "architecture", "filename", "size", "sha256"].some(
          (k) => r[k] !== first[k],
        ),
      )
    )
      fail("ambiguous package");
    const { name, version, architecture, size, sha256 } = first;
    if (
      !["amd64", "all"].includes(architecture) ||
      seen.has(name) ||
      filename !==
        `${name}_${version.replaceAll(":", "%3a")}_${architecture}.deb`
    )
      fail(`invalid package filename ${filename}`);
    seen.add(name);
    if (!DOCKER.includes(name) && plan.get(name) !== version)
      fail(`plan mismatch ${name}`);
    packages.push({ name, version, architecture, filename, size, sha256 });
    provenance.push({
      name,
      matches: matches.map(({ suite, component, sourcePath }) => ({
        suite,
        component,
        sourcePath,
      })),
    });
    entries.push([filename, data]);
  }
  if (
    [...plan.keys(), ...ROOTS, ...DOCKER].some((name) => !seen.has(name)) ||
    ROOTS.length !== 33 ||
    new Set(ROOTS).size !== 33 ||
    DOCKER.some((n) => plan.has(n))
  )
    fail("package roots or plan mismatch");
  const archive = tar(entries);
  const manifest = {
    schemaVersion: 1,
    suite: "noble",
    architecture: "amd64",
    archiveSha256: hash(archive),
    packages,
  };
  const evidence = {
    keyringSha256: hash(keyBytes),
    signingFingerprint: SIGNING_FINGERPRINT,
    sources,
    packageSources: provenance,
    resolver: {
      image:
        "ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852",
      simulation: "apt-get with empty status and --no-install-recommends",
      planSha256: hash(regular(path.join(dir, "plan.txt"), 1024 * 1024)),
    },
    playwright: { version: "1.63.0", roots: ROOTS },
    extractionOnly: DOCKER,
  };
  for (const [name, value] of [
    ["ubuntu-ci-bundle.tar", archive],
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["provenance.json", `${JSON.stringify(evidence, null, 2)}\n`],
  ])
    writeFileSync(path.join(dir, name), value, { mode: 0o600, flag: "wx" });
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    fail("usage: node prepare-ubuntu-ci-bundle.mjs PRIVATE_DIRECTORY");
  const result = prepare(path.resolve(process.argv[2]));
  process.stdout.write(
    `${result.packages.length} packages; archive sha256 ${result.archiveSha256}\n`,
  );
}

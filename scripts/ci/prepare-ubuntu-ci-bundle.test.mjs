import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  fields,
  indexRecord,
  matchBytes,
  parsePlan,
  tar,
  verifySignature,
} from "./prepare-ubuntu-ci-bundle.mjs";

const fingerprint = "F6ECB3762474EDA9D21B7022871920D1991BC93C";
test("signature must be the one pinned primary key and cannot include errors", () => {
  verifySignature(`[GNUPG:] VALIDSIG ${fingerprint} data ${fingerprint}`);
  assert.throws(() =>
    verifySignature(`[GNUPG:] VALIDSIG ${"A".repeat(40)} data ${fingerprint}`),
  );
  assert.throws(() =>
    verifySignature(
      `[GNUPG:] VALIDSIG ${fingerprint} data ${fingerprint}\n[GNUPG:] BADSIG x`,
    ),
  );
  assert.throws(() => verifySignature(""));
});
test("signed index record and bytes must agree uniquely", () => {
  const b = Buffer.from("index");
  const digest = createHash("sha256").update(b).digest("hex");
  const line = ` ${digest} 5 main/binary-amd64/Packages.xz`;
  const text = `\nSHA256:\n${line}\nOther: x`;
  matchBytes(b, indexRecord(text, "main/binary-amd64/Packages.xz"));
  assert.throws(() =>
    matchBytes(
      Buffer.from("alter"),
      indexRecord(text, "main/binary-amd64/Packages.xz"),
    ),
  );
  assert.throws(() =>
    indexRecord(
      `\nSHA256:\n${line}\n${line}\nOther: x`,
      "main/binary-amd64/Packages.xz",
    ),
  );
  assert.throws(() => indexRecord(text, "missing"));
});
test("records reject duplicate and malformed fields", () => {
  assert.deepEqual(fields("Package: abc\nVersion: 1\n continuation"), {
    Package: "abc",
    Version: "1",
  });
  assert.throws(() => fields("Package: abc\nPackage: def"));
  assert.throws(() => fields("invalid"));
});
test("plan requires 148 unique installation records", () => {
  const lines = Array.from(
    { length: 148 },
    (_, i) => `Inst package${i} (1.0 Ubuntu [amd64])`,
  );
  assert.equal(parsePlan(lines.join("\n")).size, 148);
  assert.throws(() => parsePlan(lines.slice(1).join("\n")));
  assert.throws(() => parsePlan([...lines, lines[0]].join("\n")));
});
test("tar is deterministic and rejects extra paths or duplicate ordering", () => {
  const entries = [["a_1_amd64.deb", Buffer.from("payload")]];
  const archive = tar(entries);
  assert.deepEqual(archive, tar(entries));
  assert.equal(archive.length, 2048);
  assert.ok(archive.subarray(-1024).every((n) => n === 0));
  assert.throws(() => tar([["../evil.deb", Buffer.from("x")]]));
  assert.throws(() => tar([entries[0], entries[0]]));
});

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepare, verifiedRelease } from "./prepare-ubuntu-ci-bundle.mjs";

const GPG = [
  "/usr/bin/gpg",
  "/opt/homebrew/bin/gpg",
  "/usr/local/bin/gpg",
].find((candidate) => existsSync(candidate));
function signer(t) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "prep-gpg-")));
  t.after(() => {
    spawnSync(GPG.replace(/gpg$/, "gpgconf"), [
      "--homedir",
      home,
      "--kill",
      "all",
    ]);
    rmSync(home, { recursive: true, force: true });
  });
  const gpg = (args, input) =>
    spawnSync(GPG, ["--homedir", home, "--batch", "--no-tty", ...args], {
      input,
      encoding: "buffer",
    });
  const generated = gpg([
    "--passphrase",
    "",
    "--quick-gen-key",
    "t@example.invalid",
    "rsa2048",
    "sign",
    "never",
  ]);
  // Hosts that cannot run gpg-agent (restricted sandboxes) skip these tests.
  if (generated.status !== 0) return null;
  const listing = gpg(["--with-colons", "--list-keys"]).stdout.toString();
  const key = /^fpr:+([A-F0-9]{40}):/m.exec(listing)[1];
  const keyring = path.join(home, "keyring.gpg");
  writeFileSync(keyring, gpg(["--export"]).stdout);
  return {
    key,
    keyring,
    home,
    sign: (text) => gpg(["--clearsign"], Buffer.from(text)).stdout,
  };
}
const NOW = Date.parse("2026-11-12T00:00:00Z");
const release = (
  suite,
  date = "Wed, 11 Nov 2026 09:35:45 UTC",
  extra = "MD5Sum:\n",
) =>
  `Origin: Ubuntu\nLabel: Ubuntu\nSuite: ${suite}\nCodename: noble\nDate: ${date}\n${extra}SHA256:\n ${"a".repeat(64)} 10 main/binary-amd64/Packages.xz\n`;
const place = (dir, name, bytes) => writeFileSync(path.join(dir, name), bytes);

test("only the gpgv-authenticated plaintext is parsed; prepended unsigned stanzas are rejected", (t) => {
  const s = GPG ? signer(t) : null;
  if (!s) return t.skip("gpg signing unavailable");
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "prep-rel-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = { key: s.key, nowMs: NOW };
  const good = s.sign(release("noble-updates"));
  place(dir, "good", good);
  const ok = verifiedRelease(
    path.join(dir, "good"),
    s.keyring,
    "noble-updates",
    options,
  );
  assert.match(
    indexRecord(ok.text, "main/binary-amd64/Packages.xz").sha256,
    /^a{64}$/,
  );
  const forged = `Origin: Ubuntu\nSuite: noble-updates\nSHA256:\n ${"b".repeat(64)} 10 main/binary-amd64/Packages.xz\n\n`;
  for (const bytes of [
    Buffer.concat([Buffer.from(forged), good]),
    Buffer.concat([good, Buffer.from("\ntrailing")]),
    Buffer.concat([good, good]),
  ]) {
    place(dir, "bad", bytes);
    assert.throws(
      () =>
        verifiedRelease(
          path.join(dir, "bad"),
          s.keyring,
          "noble-updates",
          options,
        ),
      /malformed release metadata|signature/,
    );
  }
});

test("release freshness, identity and structure bounds are enforced", (t) => {
  const s = GPG ? signer(t) : null;
  if (!s) return t.skip("gpg signing unavailable");
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "prep-rel-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = { key: s.key, nowMs: NOW };
  const check = (suite, text) => {
    place(dir, "r", s.sign(text));
    return () =>
      verifiedRelease(path.join(dir, "r"), s.keyring, suite, options);
  };
  assert.throws(
    check(
      "noble-updates",
      release("noble-updates", "Mon, 01 Jan 2026 00:00:00 UTC"),
    ),
    /stale release metadata/,
  );
  assert.throws(
    check(
      "noble-security",
      release("noble-security", "Mon, 01 Jan 2026 00:00:00 UTC"),
    ),
    /stale release metadata/,
  );
  check("noble", release("noble", "Thu, 25 Apr 2024 15:10:33 UTC"))();
  assert.throws(
    check("noble", release("noble", "Mon, 01 Jan 2030 00:00:00 UTC")),
    /release identity or date/,
  );
  assert.throws(
    check("noble", release("jammy", "Thu, 25 Apr 2024 15:10:33 UTC")),
    /release identity or date/,
  );
  assert.throws(
    check("noble-updates", release("noble-updates").replace("MD5Sum:\n", "")),
    /malformed release metadata/,
  );
  place(dir, "r", Buffer.from("not signed"));
  assert.throws(
    () => verifiedRelease(path.join(dir, "r"), s.keyring, "noble", options),
    /malformed release metadata/,
  );
  const other = signer(t);
  place(
    dir,
    "r",
    other.sign(release("noble", "Thu, 25 Apr 2024 15:10:33 UTC")),
  );
  assert.throws(
    () => verifiedRelease(path.join(dir, "r"), s.keyring, "noble", options),
    /./,
  );
});

test("prepare rejects forged, stale or malformed release metadata before building anything", (t) => {
  const s = GPG ? signer(t) : null;
  if (!s) return t.skip("gpg signing unavailable");
  const options = { key: s.key, nowMs: NOW };
  const build = (mutate) => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "prep-e2e-")));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const sub of ["debs", "indexes"]) mkdirSync(path.join(dir, sub));
    writeFileSync(path.join(dir, "keyring.gpg"), readFileSync(s.keyring));
    const texts = {
      noble: release("noble", "Thu, 25 Apr 2024 15:10:33 UTC"),
      "noble-updates": release("noble-updates"),
      "noble-security": release("noble-security"),
    };
    mutate(texts);
    for (const [suite, text] of Object.entries(texts))
      place(dir, `${suite}.InRelease`, s.sign(text));
    return dir;
  };
  assert.throws(
    () =>
      prepare(
        build(
          (x) =>
            (x["noble-updates"] = release(
              "noble-updates",
              "Mon, 01 Jan 2026 00:00:00 UTC",
            )),
        ),
        options,
      ),
    /stale release metadata/,
  );
  assert.throws(
    () =>
      prepare(
        build(
          (x) =>
            (x["noble-security"] = release("noble-security").replace(
              "MD5Sum:\n",
              "",
            )),
        ),
        options,
      ),
    /malformed release metadata/,
  );
  const dir = build(() => {});
  place(
    dir,
    "noble.InRelease",
    Buffer.concat([
      Buffer.from("Origin: Ubuntu\n"),
      readFileSync(path.join(dir, "noble.InRelease")),
    ]),
  );
  assert.throws(() => prepare(dir, options), /malformed release metadata/);
  const clean = build(() => {});
  assert.throws(() => prepare(clean, options), /no such file|index/i);
  assert.deepEqual(
    readdirSync(clean).filter(
      (n) => n.startsWith("ubuntu-ci-bundle") || n === "manifest.json",
    ),
    [],
  );
});

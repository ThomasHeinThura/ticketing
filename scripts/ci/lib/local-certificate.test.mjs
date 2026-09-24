import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const helper = path.join(root, "scripts/lib/local-certificate.sh");

function runHelper(certDir, domain) {
  return spawnSync(
    "bash",
    ["-euc", `. "${helper}"; prepare_local_certificate "$CERT_DIR" "$DOMAIN"`],
    {
      encoding: "utf8",
      env: { ...process.env, CERT_DIR: certDir, DOMAIN: domain },
    },
  );
}

function openssl(args) {
  const result = spawnSync("openssl", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe("local TLS certificate generation", () => {
  it("creates a non-CA leaf certificate with all routes and a protected key", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "taskdesk-local-cert-"));
    const certDir = path.join(temp, "certs");
    try {
      const result = runHelper(certDir, "dev.example.test");
      assert.equal(result.status, 0, result.stderr);

      const certificate = path.join(certDir, "local.crt");
      const certText = openssl(["x509", "-in", certificate, "-noout", "-text"]);
      assert.match(certText, /CA:FALSE/);
      assert.match(certText, /Digital Signature, Key Encipherment/);
      assert.match(certText, /TLS Web Server Authentication/);
      for (const host of ["ticket", "portal", "mail", "files"]) {
        assert.equal(
          spawnSync("openssl", [
            "x509",
            "-in",
            certificate,
            "-noout",
            "-checkhost",
            `${host}.dev.example.test`,
          ]).status,
          0,
        );
      }
      assert.equal(
        spawnSync("openssl", [
          "x509",
          "-in",
          certificate,
          "-noout",
          "-checkend",
          "2592000",
        ]).status,
        0,
      );
      assert.equal(
        (await readFile(path.join(certDir, "local.key"))).length > 0,
        true,
      );
      assert.equal(
        (await stat(path.join(certDir, "local.key"))).mode & 0o777,
        0o600,
      );
      assert.deepEqual((await readdir(certDir)).sort(), [
        "local.crt",
        "local.key",
      ]);

      const oldCert = await readFile(certificate);
      const oldKey = await readFile(path.join(certDir, "local.key"));
      const secondRun = runHelper(certDir, "dev.example.test");
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.deepEqual(await readFile(certificate), oldCert);
      assert.deepEqual(await readFile(path.join(certDir, "local.key")), oldKey);
      assert.deepEqual((await readdir(certDir)).sort(), [
        "local.crt",
        "local.key",
      ]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe or malformed DNS names before writing any certificate", async () => {
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-local-cert-domain-"),
    );
    try {
      for (const domain of [
        "bad, DNS:attacker.test",
        "../attacker",
        "has_underscore.test",
        "-starts.test",
        "ends-.test",
        "bad..test",
        `${"a".repeat(64)}.test`,
      ]) {
        const certDir = path.join(
          temp,
          domain.replaceAll(/[^A-Za-z0-9]/g, "_").slice(0, 30),
        );
        const result = runHelper(certDir, domain);
        assert.notEqual(result.status, 0, `expected rejection for ${domain}`);
        assert.deepEqual(await readdir(certDir).catch(() => []), []);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("preserves existing local TLS material before renewing it", async () => {
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-local-cert-backup-"),
    );
    const certDir = path.join(temp, "certs");
    const oldDir = path.join(temp, "old");
    try {
      await mkdir(certDir);
      await mkdir(oldDir);
      const made = spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "825",
          "-subj",
          "/CN=wrong.example.test",
          "-addext",
          "subjectAltName=DNS:wrong.example.test",
          "-keyout",
          path.join(oldDir, "old.key"),
          "-out",
          path.join(oldDir, "old.crt"),
        ],
        { encoding: "utf8", stdio: "ignore" },
      );
      assert.equal(made.status, 0);
      await copyFile(
        path.join(oldDir, "old.crt"),
        path.join(certDir, "local.crt"),
      );
      await copyFile(
        path.join(oldDir, "old.key"),
        path.join(certDir, "local.key"),
      );
      const originalCert = await readFile(path.join(certDir, "local.crt"));
      const originalKey = await readFile(path.join(certDir, "local.key"));

      const result = runHelper(certDir, "dev.example.test");
      assert.equal(result.status, 0, result.stderr);
      const entries = await readdir(certDir);
      const backupName = entries.find((entry) => entry.startsWith("replaced-"));
      assert.ok(
        backupName,
        "renewal should preserve the previous certificate and key",
      );
      assert.match(result.stderr, /Saved the previous local TLS material/);
      assert.deepEqual(
        await readFile(path.join(certDir, backupName, "local.crt")),
        originalCert,
      );
      assert.deepEqual(
        await readFile(path.join(certDir, backupName, "local.key")),
        originalKey,
      );
      assert.match(
        openssl([
          "x509",
          "-in",
          path.join(certDir, "local.crt"),
          "-noout",
          "-text",
        ]),
        /CA:FALSE/,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});

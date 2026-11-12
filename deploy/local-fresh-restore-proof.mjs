import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";

export class ProofCleanupUncertain extends Error {}

const restoreProofBrand = Symbol("taskdesk.localFresh.restoreProof");

export function isVerifiedRestoreProof(value) {
  return Boolean(
    value &&
      value[restoreProofBrand] === true &&
      value.verified === true &&
      typeof value.attachmentManifest === "string",
  );
}

export function writeRestoreProofRecord(backupDir, reference, receipt) {
  if (receipt?.verified !== true)
    throw new Error("Restore proof did not return a verified receipt.");
  const file = resolve(backupDir, "restore-proof.json");
  const record = {
    version: 1,
    reference,
    verified: true,
    verifiedAt: receipt.verifiedAt || new Date().toISOString(),
    attachmentManifest: String(receipt.attachmentManifest ?? "[]"),
  };
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dirFd = openSync(backupDir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

export function readRestoreProofRecord(backupDir, reference) {
  const file = resolve(backupDir, "restore-proof.json");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Persisted restore proof is not a regular file.");
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (
    value?.version !== 1 ||
    value.verified !== true ||
    value.reference !== reference ||
    typeof value.attachmentManifest !== "string"
  )
    throw new Error("Persisted restore proof is invalid.");
  return value;
}

// Run on the live application and on the extracted archive. Reject symlinks and
// special files, so the verification represents file bytes and directory paths.
export const attachmentManifestCode = `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const root=process.argv[1],out=[];function walk(rel){for(const name of fs.readdirSync(path.join(root,rel)).sort()){const p=path.join(rel,name),f=path.join(root,p),s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){out.push(['d',p]);walk(p)}else if(s.isFile()){const h=crypto.createHash('sha256'),fd=fs.openSync(f,'r'),buf=Buffer.alloc(65536);try{for(;;){const n=fs.readSync(fd,buf,0,buf.length,null);if(!n)break;h.update(buf.subarray(0,n))}}finally{fs.closeSync(fd)}out.push(['f',p,h.digest('hex')])}else throw Error('special file')}}walk('');process.stdout.write(JSON.stringify(out));`;

export function validateArchiveLists(names, details) {
  const entries = names.split(/\r?\n/).filter(Boolean);
  const verbose = details.split(/\r?\n/).filter(Boolean);
  if (entries.length !== verbose.length)
    throw new Error("Attachment archive listing is ambiguous.");
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    if (
      isAbsolute(name) ||
      name.split("/").includes("..") ||
      !/^[d-]/.test(verbose[i])
    )
      throw new Error("Unsafe attachment archive entry.");
  }
}

// Validate the tar structure before handing it to the system extractor. Extended
// headers and links are rejected rather than interpreted inconsistently by tar variants.
export function validateTarFile(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const block = Buffer.alloc(512);
    const names = new Set();
    let offset = 0;
    let terminated = false;
    const textField = (buf) => {
      const zero = buf.indexOf(0);
      const bytes = zero < 0 ? buf : buf.subarray(0, zero);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    const octal = (buf) => {
      const value = textField(buf).trim();
      if (value && !/^[0-7]+$/.test(value))
        throw new Error("Unsupported tar number.");
      const n = Number.parseInt(value || "0", 8);
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("Invalid tar number.");
      return n;
    };
    while (offset + 512 <= size) {
      if (readSync(fd, block, 0, 512, offset) !== 512)
        throw new Error("Truncated tar header.");
      offset += 512;
      if (block.every((v) => v === 0)) {
        if (
          offset + 512 > size ||
          readSync(fd, block, 0, 512, offset) !== 512 ||
          block.some((v) => v !== 0)
        )
          throw new Error("Incomplete tar terminator.");
        offset += 512;
        terminated = true;
        break;
      }
      if (
        !block.subarray(257, 263).equals(Buffer.from("ustar\0")) ||
        block.subarray(263, 265).toString("ascii") !== "00"
      )
        throw new Error("Unsupported tar format.");
      const stored = octal(block.subarray(148, 156));
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
      if (stored !== sum) throw new Error("Invalid tar header checksum.");
      const name = textField(block.subarray(0, 100));
      const prefix = textField(block.subarray(345, 500));
      const full = prefix ? `${prefix}/${name}` : name;
      if (
        !full ||
        isAbsolute(full) ||
        full.includes("\\") ||
        [...full].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ) ||
        full.split("/").includes("..")
      )
        throw new Error("Unsafe attachment archive path.");
      const type = block[156];
      if (type !== 0 && type !== 48 && type !== 53)
        throw new Error("Unsupported attachment archive entry type.");
      const normalized = full.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
      if (names.has(normalized))
        throw new Error("Duplicate attachment archive path.");
      names.add(normalized);
      const bytes = octal(block.subarray(124, 136));
      if (type === 53 && bytes !== 0)
        throw new Error("Invalid archive directory.");
      const padded = Math.ceil(bytes / 512) * 512;
      if (offset + padded > size)
        throw new Error("Truncated attachment archive.");
      offset += padded;
    }
    if (!terminated)
      throw new Error("Attachment archive terminator is missing.");
    while (offset < size) {
      const length = Math.min(512, size - offset);
      if (
        readSync(fd, block, 0, length, offset) !== length ||
        block.subarray(0, length).some((v) => v !== 0)
      )
        throw new Error("Unexpected data after tar terminator.");
      offset += length;
    }
  } finally {
    closeSync(fd);
  }
}

/** Rehearse a custom dump and attachment archive without touching SIT volumes. */
export function verifyRestoreProof({
  cmd,
  databaseId,
  databaseImage,
  dbName,
  appId,
  dump,
  counts,
  countSql,
  attachments,
  backupDir,
  report = () => {},
  validateArchive = validateTarFile,
  pause = () =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000),
}) {
  if (
    !/^[a-f0-9]{64}$/.test(databaseId) ||
    !/^[a-f0-9]{64}$/.test(appId) ||
    !/^sha256:[a-f0-9]{64}$/.test(databaseImage)
  )
    throw new Error("Restore proof inputs are unsafe.");
  const marker = randomBytes(24).toString("hex");
  const label = `info.taskdesk.restore-proof=${marker}`;
  const name = `taskdesk-fresh-restore-proof-${marker}`;
  let id;
  let extraction;
  let extractedManifest;
  let owned = false;
  let failure;
  try {
    const original = cmd("docker", [
      "exec",
      appId,
      "node",
      "-e",
      attachmentManifestCode,
      "/app/data/attachments",
    ]);
    validateArchive(attachments);
    extraction = mkdtempSync(resolve(backupDir, ".attachment-proof-"));
    cmd("tar", [
      "-C",
      extraction,
      "--no-same-owner",
      "--no-same-permissions",
      "-xf",
      attachments,
    ]);
    extractedManifest = cmd("node", ["-e", attachmentManifestCode, extraction]);
    const after = cmd("docker", [
      "exec",
      appId,
      "node",
      "-e",
      attachmentManifestCode,
      "/app/data/attachments",
    ]);
    if (original !== extractedManifest || original !== after)
      throw new Error("Attachment restore hash or file count mismatch.");
    try {
      id = cmd("docker", [
        "create",
        "--name",
        name,
        "--label",
        label,
        "--network",
        "none",
        "--tmpfs",
        "/var/lib/postgresql:rw,nosuid,nodev",
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        databaseImage,
      ]).trim();
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new Error("Restore proof container ID is invalid.");
    } catch {
      let candidates;
      try {
        candidates = cmd("docker", [
          "ps",
          "-a",
          "-q",
          "--no-trunc",
          "--filter",
          `label=${label}`,
        ])
          .trim()
          .split(/\s+/)
          .filter(Boolean);
      } catch {
        throw new ProofCleanupUncertain(
          `Cannot inspect restore proof label ${label}.`,
        );
      }
      if (candidates.length === 1 && /^[a-f0-9]{64}$/.test(candidates[0])) {
        id = candidates[0];
        const found = JSON.parse(cmd("docker", ["inspect", id]));
        if (
          found.length === 1 &&
          found[0].Id === id &&
          found[0].Name === `/${name}` &&
          found[0].Config?.Image === databaseImage &&
          found[0].Config?.Labels?.["info.taskdesk.restore-proof"] === marker
        )
          owned = true;
      }
      if (
        candidates.length > 1 ||
        (candidates.length === 1 && !/^[a-f0-9]{64}$/.test(candidates[0]))
      )
        throw new ProofCleanupUncertain(
          `Restore proof creation is ambiguous; inspect label ${label}.`,
        );
      throw new Error("Restore proof container creation failed.");
    }
    const result = JSON.parse(cmd("docker", ["inspect", id]));
    const c = result[0];
    if (
      result.length !== 1 ||
      c.Id !== id ||
      c.Name !== `/${name}` ||
      c.Config?.Labels?.["info.taskdesk.restore-proof"] !== marker ||
      c.Config?.Image !== databaseImage
    )
      throw new Error("Restore proof ownership is not confirmed.");
    owned = true;
    if (
      c.HostConfig?.NetworkMode !== "none" ||
      c.HostConfig?.PublishAllPorts !== false ||
      Object.keys(c.HostConfig?.PortBindings || {}).length ||
      !Array.isArray(c.Mounts) ||
      c.Mounts.length ||
      !c.HostConfig?.Tmpfs?.["/var/lib/postgresql"]
    )
      throw new Error("Restore proof isolation is not confirmed.");
    cmd("docker", ["start", id]);
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        cmd("docker", ["exec", id, "pg_isready", "-U", "postgres"]);
        ready = true;
        break;
      } catch {
        if (i < 29) pause();
      }
    }
    if (!ready) throw new Error("Restore proof database did not become ready.");
    const fd = openSync(dump, "r");
    try {
      cmd(
        "docker",
        [
          "exec",
          "-i",
          id,
          "pg_restore",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { stdio: [fd, "pipe", "pipe"] },
      );
    } finally {
      closeSync(fd);
    }
    const expectedCounts = readFileSync(counts, "utf8");
    const restored = cmd(
      "docker",
      [
        "exec",
        "-i",
        id,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { input: `${countSql}\n` },
    );
    if (restored !== expectedCounts)
      throw new Error("Restored database table or row counts mismatch.");
    if (dbName) {
      const activeWriters = cmd("docker", [
        "exec",
        databaseId,
        "sh",
        "-c",
        'exec psql -X -Atqc "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> \'idle\'" -U "$POSTGRES_USER" -d "$1"',
        "writers",
        dbName,
      ]).trim();
      if (activeWriters !== "0")
        throw new Error(
          "Active database sessions detected during snapshot verification; quiesce writers before retrying.",
        );
      const liveCounts = cmd(
        "docker",
        [
          "exec",
          "-i",
          databaseId,
          "sh",
          "-c",
          'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"',
          "counts",
          dbName,
        ],
        { input: `${countSql}\n` },
      );
      if (liveCounts !== expectedCounts)
        throw new Error(
          "Live database changed during backup verification; quiesce writers before retrying.",
        );
    }
    report("Restore proof matched database counts and attachment hashes.");
  } catch (error) {
    failure = error;
  }
  if (id && owned) {
    try {
      cmd("docker", ["rm", "-f", "-v", id]);
      if (
        cmd("docker", [
          "ps",
          "-a",
          "-q",
          "--no-trunc",
          "--filter",
          `id=${id}`,
        ]).trim()
      )
        throw new Error(
          "Restore proof container cleanup could not be confirmed.",
        );
    } catch {
      failure = new ProofCleanupUncertain(
        `Restore proof container cleanup failed; inspect exact ID ${id}.`,
      );
    }
  } else if (id) {
    failure = new ProofCleanupUncertain(
      `Restore proof ownership is uncertain; inspect exact ID ${id}.`,
    );
  }
  if (extraction) {
    try {
      rmSync(extraction, { recursive: true });
    } catch {
      failure = new Error("Restore proof temporary directory cleanup failed.");
    }
  }
  if (failure) throw failure;
  return {
    [restoreProofBrand]: true,
    verified: true,
    verifiedAt: new Date().toISOString(),
    attachmentManifest: extractedManifest,
  };
}

#!/usr/bin/env node
// Recovery archive validation uses only Node's standard library. Never extract an
// unvalidated archive: tar listings alone do not inspect all payload/trailer bytes.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const archiveMembers = ["postgres.dump", "attachments.tar"];
function members(directory) {
  const identity = join(directory, "source-identity.json");
  return existsSync(identity) ||
    (() => {
      try {
        lstatSync(identity);
        return true;
      } catch {
        return false;
      }
    })()
    ? [...archiveMembers, "source-identity.json"]
    : archiveMembers;
}
const fail = (message) => {
  throw new Error(message);
};

function regular(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    fail("Backup members must be regular files.");
}

function digest(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) fail("Backup member is not a regular file.");
    const hash = createHash("sha256");
    const block = Buffer.alloc(1024 * 1024);
    for (;;) {
      const count = readSync(fd, block, 0, block.length, null);
      if (!count) break;
      hash.update(block.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

function validateTar(file) {
  regular(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    if (size < 1024 || size % 512) fail("Attachment archive is truncated.");
    let offset = 0;
    let longName = null;
    const names = new Map();
    const parents = new Set();
    const block = Buffer.alloc(512);
    const readBlock = () => {
      if (readSync(fd, block, 0, 512, offset) !== 512)
        fail("Attachment archive is truncated.");
      offset += 512;
      return block;
    };
    const string = (start, end) => {
      const field = block.subarray(start, end);
      const nul = field.indexOf(0);
      if (nul !== -1 && field.subarray(nul).some((b) => b !== 0))
        fail("Invalid tar string padding.");
      const bytes = nul === -1 ? field : field.subarray(0, nul);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    const octal = (start, end) => {
      const field = block.subarray(start, end);
      if (field.some((byte) => byte > 127))
        fail("Unsupported tar numeric encoding.");
      const value = field
        .toString("ascii")
        .replace(/[\0 ]+$/g, "")
        .trim();
      if (!/^[0-7]+$/.test(value)) fail("Unsupported tar numeric encoding.");
      const number = Number.parseInt(value, 8);
      if (!Number.isSafeInteger(number)) fail("Tar number exceeds safe range.");
      return number;
    };
    while (offset < size) {
      readBlock();
      if (block.every((b) => b === 0)) {
        if (longName !== null) fail("GNU long name has no following member.");
        if (offset === size || readBlock().some((b) => b !== 0))
          fail("Tar requires two end blocks.");
        while (offset < size)
          if (readBlock().some((b) => b !== 0))
            fail("Unexpected data after tar end marker.");
        return;
      }
      const checksum = octal(148, 156);
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
      if (sum !== checksum) fail("Tar header checksum mismatch.");
      if (block.subarray(257, 265).some((byte) => byte > 127))
        fail("Unsupported tar format.");
      const magic = block.subarray(257, 263).toString("ascii");
      if (!["ustar\0", "ustar ", "\0\0\0\0\0\0"].includes(magic))
        fail("Unsupported tar format.");
      if (magic !== "ustar\0" && block.subarray(345).some((b) => b !== 0))
        fail("Unsupported extended tar header.");
      if (
        magic === "ustar\0" &&
        block.subarray(263, 265).toString("ascii") !== "00"
      )
        fail("Unsupported tar version.");
      if (magic === "ustar\0" && block.subarray(500).some((byte) => byte !== 0))
        fail("Unsupported tar header padding.");
      // Validate the remaining numeric fields consumed by the extractor too.
      if (
        octal(100, 108) > 0o7777 ||
        octal(108, 116) > 0xffffffff ||
        octal(116, 124) > 0xffffffff
      )
        fail("Unsupported tar ownership or permissions.");
      octal(136, 148);
      // BusyBox parses device fields even for regular files. Only absent/zero
      // device numbers are meaningful for the file/directory subset we accept.
      for (const start of [329, 337]) {
        if (
          block.subarray(start, start + 8).some((byte) => byte !== 0) &&
          octal(start, start + 8) !== 0
        )
          fail("Unexpected tar device number.");
      }
      // BusyBox can interpret a zero-length regular entry with a linkname as a
      // hardlink. Do not rely on the type flag alone to exclude links.
      if (block.subarray(157, 257).some((byte) => byte !== 0))
        fail("Tar link targets are not supported.");
      const type = block[156];
      if (![0, 48, 53, 76].includes(type))
        fail(
          "Tar links, special files and extended headers are not supported.",
        );
      const prefix = magic === "ustar\0" ? string(345, 500) : "";
      // The ignored 100-byte short name may end mid-UTF-8 sequence when the
      // writer truncates it. BusyBox uses only the pending long name in this case.
      const headerName =
        longName !== null && type !== 76
          ? null
          : `${prefix ? `${prefix}/` : ""}${string(0, 100)}`;
      const bytes = octal(124, 136);
      const padded = Math.ceil(bytes / 512) * 512;
      if (offset + padded > size - 1024) fail("Tar payload is truncated.");
      if (type === 76) {
        // BusyBox's writer emits GNU L records for normal application keys.
        // Accept exactly one NUL-terminated name for the immediately following
        // file/directory; PAX, GNU K and chained overrides remain unsupported.
        if (
          longName !== null ||
          headerName !== "././@LongLink" ||
          bytes < 2 ||
          bytes > 4095
        )
          fail("Invalid GNU long-name record.");
        const payload = Buffer.alloc(bytes);
        for (let i = 0; i < padded; i += 512) {
          readBlock();
          block.copy(payload, i, 0, Math.min(512, bytes - i));
          if (
            i + 512 > bytes &&
            block.subarray(bytes - i).some((byte) => byte !== 0)
          )
            fail("Invalid tar payload padding.");
        }
        if (
          payload[bytes - 1] !== 0 ||
          payload.subarray(0, bytes - 1).includes(0)
        )
          fail("Invalid GNU long-name termination.");
        longName = new TextDecoder("utf-8", { fatal: true }).decode(
          payload.subarray(0, bytes - 1),
        );
        continue;
      }
      const name = longName ?? headerName;
      longName = null;
      if (
        !name ||
        name.startsWith("/") ||
        name.includes("\\") ||
        [...name].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        fail("Unsafe tar member path.");
      const parts = name.split("/");
      if (parts.includes("..")) fail("Tar path traversal is forbidden.");
      const segments = parts.filter((p) => p && p !== ".");
      const normalized = segments.join("/");
      const directory = type === 53;
      // BusyBox treats an ordinary regular name ending in '/' as a directory
      // and ignores its declared size. That would expose payload as headers.
      if (!directory && (name.endsWith("/") || name.endsWith("/.")))
        fail("Regular tar member names a directory.");
      if (!normalized && !directory) fail("Tar root must be a directory.");
      if (names.has(normalized)) fail("Duplicate tar member path.");
      names.set(normalized, directory);
      for (let i = 1; i < segments.length; i++) {
        const parent = segments.slice(0, i).join("/");
        parents.add(parent);
        if (names.get(parent) === false) fail("Tar member has a file parent.");
      }
      if (!directory && parents.has(normalized))
        fail("Tar file replaces a directory.");
      if (directory && bytes !== 0) fail("Tar directory has a payload.");
      // Read every payload block; also require zero padding in the last one.
      for (let i = 0; i < padded; i += 512) {
        readBlock();
        if (i + 512 > bytes && block.subarray(bytes - i).some((b) => b !== 0))
          fail("Invalid tar payload padding.");
      }
    }
    fail("Tar end marker is missing.");
  } finally {
    closeSync(fd);
  }
}

function verify(directory) {
  for (const member of [...members(directory), "SHA256SUMS"])
    regular(join(directory, member));
  const checksums = readFileSync(join(directory, "SHA256SUMS"), "utf8");
  const lines = checksums.trimEnd().split("\n");
  if (lines.length !== members(directory).length)
    fail("Checksum file must cover exactly the backup members.");
  const seen = new Set();
  for (const line of lines) {
    const match =
      /^([a-fA-F0-9]{64}) [ *](postgres\.dump|attachments\.tar|source-identity\.json)$/.exec(
        line,
      );
    if (!match || !members(directory).includes(match[2]) || seen.has(match[2]))
      fail("Invalid or duplicate checksum member.");
    seen.add(match[2]);
    if (digest(join(directory, match[2])) !== match[1].toLowerCase())
      fail("Backup checksum mismatch.");
  }
  if (!lstatSync(join(directory, "postgres.dump")).size)
    fail("Database archive is empty.");
  validateTar(join(directory, "attachments.tar"));
}

try {
  const [command, source, target, ...extra] = process.argv.slice(2);
  if (!source || extra.length) fail("Invalid archive command.");
  if (command === "tar" && !target) validateTar(source);
  else if (command === "verify" && !target) verify(source);
  else if (command === "checksums" && !target) {
    writeFileSync(
      join(source, "SHA256SUMS"),
      members(source)
        .map((name) => `${digest(join(source, name))}  ${name}\n`)
        .join(""),
      { mode: 0o600, flag: "wx" },
    );
  } else if (command === "snapshot" && target) {
    for (const name of [...members(source), "SHA256SUMS"]) {
      regular(join(source, name));
      copyFileSync(
        join(source, name),
        join(target, name),
        constants.COPYFILE_EXCL,
      );
    }
    verify(target);
  } else if (command === "publish" && target) {
    verify(source);
    // mkdir is the no-replace reservation: unlike check-then-rename, it cannot
    // replace even an empty directory introduced by another publisher. All
    // members are linked exclusively; SHA256SUMS is the last, atomic completion
    // record. An interrupted publication is retained without that record and
    // is refused by restore. The caller removes its private staging links.
    mkdirSync(target, { mode: 0o700 });
    for (const name of [...members(source), "SHA256SUMS"])
      linkSync(join(source, name), join(target, name));
  } else fail("Invalid archive command.");
} catch {
  // File paths and archive contents can contain private data. Do not echo them.
  console.error(
    "xx Backup archive validation or publication failed; no verified backup was published.",
  );
  process.exitCode = 1;
}

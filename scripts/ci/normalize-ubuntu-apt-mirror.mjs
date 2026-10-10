#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APT_ROOT = "/etc/apt";
const BLOCKED_UBUNTU_URI = "http://azure.archive.ubuntu.com/ubuntu";
const HTTPS_UBUNTU_URI = "https://archive.ubuntu.com/ubuntu";
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function replaceUriToken(token) {
  const hasTrailingSlash = token.endsWith("/");
  const normalized = hasTrailingSlash ? token.slice(0, -1) : token;
  return normalized === BLOCKED_UBUNTU_URI
    ? `${HTTPS_UBUNTU_URI}${hasTrailingSlash ? "/" : ""}`
    : token;
}

function rewriteMirrorListLine(line) {
  return line.replace(
    /^(\s*)(\S+)/,
    (_match, leading, uri) => `${leading}${replaceUriToken(uri)}`,
  );
}

function rewriteSourceListLine(line) {
  return line.replace(
    /^(\s*(?:deb|deb-src)\s+(?:\[[^\]]*\]\s+)?)(\S+)/,
    (_match, prefix, uri) => `${prefix}${replaceUriToken(uri)}`,
  );
}

function rewriteDeb822Line(line, inUrisField) {
  const field = line.match(/^([A-Za-z][A-Za-z0-9-]*):(.*)$/);
  if (field) {
    if (field[1].toLowerCase() !== "uris") return { line, inUrisField: false };
    return {
      line: `${field[1]}:${field[2].replace(/\S+/g, replaceUriToken)}`,
      inUrisField: true,
    };
  }
  if (!inUrisField || !/^\s+\S/.test(line) || /^\s*#/.test(line))
    return { line, inUrisField: false };
  return { line: line.replace(/\S+/g, replaceUriToken), inUrisField: true };
}

export function normalizeAptSourceContent(content, kind) {
  if (kind === "mirror-list")
    return content.replace(/[^\r\n]+/g, rewriteMirrorListLine);
  if (kind === "source-list")
    return content.replace(/[^\r\n]+/g, rewriteSourceListLine);
  if (kind !== "deb822")
    throw new Error(`Unsupported APT source format: ${kind}`);

  let inUrisField = false;
  return content.replace(/[^\r\n]+/g, (line) => {
    const rewritten = rewriteDeb822Line(line, inUrisField);
    inUrisField = rewritten.inUrisField;
    return rewritten.line;
  });
}

async function assertOwnedDirectory(directory, expectedOwner) {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== expectedOwner
  )
    throw new Error(`Refusing unsafe APT directory: ${directory}`);
}

async function replaceFileAtomically(filePath, content, originalInfo) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.taskdesk-apt-${randomBytes(12).toString("hex")}.tmp`,
  );
  const mode = originalInfo.mode & 0o7777;
  let temporaryHandle;
  try {
    temporaryHandle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
      mode,
    );
    await temporaryHandle.writeFile(content, "utf8");
    await temporaryHandle.chmod(mode);
    await temporaryHandle.chown(originalInfo.uid, originalInfo.gid);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const current = await lstat(filePath);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.uid !== originalInfo.uid ||
      current.dev !== originalInfo.dev ||
      current.ino !== originalInfo.ino ||
      current.nlink !== 1
    ) {
      throw new Error(`APT source changed while being normalized: ${filePath}`);
    }
    await rename(temporaryPath, filePath);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await temporaryHandle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

async function normalizeFile(filePath, kind, expectedOwner) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== expectedOwner ||
    info.nlink !== 1
  ) {
    throw new Error(`Refusing unsafe APT source file: ${filePath}`);
  }

  const fileHandle = await open(filePath, constants.O_RDONLY | NOFOLLOW);
  let original;
  try {
    const openedInfo = await fileHandle.stat();
    if (openedInfo.dev !== info.dev || openedInfo.ino !== info.ino)
      throw new Error(`APT source changed while being read: ${filePath}`);
    original = await fileHandle.readFile({ encoding: "utf8" });
  } finally {
    await fileHandle.close();
  }
  const normalized = normalizeAptSourceContent(original, kind);
  if (normalized === original) return false;
  await replaceFileAtomically(filePath, normalized, info);
  return true;
}

export async function normalizeAptSourceTree(aptRoot = APT_ROOT) {
  const expectedOwner =
    typeof process.geteuid === "function" ? process.geteuid() : 0;
  try {
    await assertOwnedDirectory(aptRoot, expectedOwner);
  } catch (error) {
    if (error?.code === "ENOENT") return { changed: [], missing: true };
    throw error;
  }

  const files = [
    [path.join(aptRoot, "apt-mirrors.txt"), "mirror-list"],
    [path.join(aptRoot, "sources.list"), "source-list"],
  ];
  const sourceDirectory = path.join(aptRoot, "sources.list.d");
  try {
    await assertOwnedDirectory(sourceDirectory, expectedOwner);
    for (const entry of await readdir(sourceDirectory, {
      withFileTypes: true,
    })) {
      if (
        entry.isSymbolicLink() &&
        (entry.name.endsWith(".list") || entry.name.endsWith(".sources"))
      ) {
        throw new Error(
          `Refusing symlinked APT source file: ${path.join(sourceDirectory, entry.name)}`,
        );
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".list"))
        files.push([path.join(sourceDirectory, entry.name), "source-list"]);
      else if (entry.name.endsWith(".sources"))
        files.push([path.join(sourceDirectory, entry.name), "deb822"]);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const changed = [];
  for (const [filePath, kind] of files) {
    if (await normalizeFile(filePath, kind, expectedOwner))
      changed.push(filePath);
  }
  return { changed, missing: false };
}

async function main() {
  if (process.platform !== "linux") {
    console.log("APT mirror normalization skipped: runner is not Linux.");
    return;
  }
  const osRelease = await readFile("/etc/os-release", "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const distroId = osRelease.match(/^ID=(?:"([^"]+)"|'([^']+)'|([^\n]+))$/m);
  if ((distroId?.[1] ?? distroId?.[2] ?? distroId?.[3]) !== "ubuntu") {
    console.log("APT mirror normalization skipped: runner is not Ubuntu.");
    return;
  }
  if (typeof process.getuid !== "function" || process.getuid() !== 0)
    throw new Error(
      "Run APT mirror normalization with sudo before Playwright install.",
    );

  const result = await normalizeAptSourceTree();
  if (result.missing) {
    console.log("APT mirror normalization skipped: /etc/apt is absent.");
  } else if (result.changed.length === 0) {
    console.log(
      "APT mirror normalization unchanged: blocked mirror not configured.",
    );
  } else {
    console.log(
      `Normalized blocked Ubuntu mirror in ${result.changed.length} APT source file(s).`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

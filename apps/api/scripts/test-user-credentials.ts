import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export type TestUserCredential = {
  role: string;
  email: string;
  password: string | null;
  authentication: "local_password" | "external_provider_required";
  scope: { kind: string; scopeId: string | null };
};

export type TestUserCredentialManifest = {
  formatVersion: 1;
  targetDatabase: string;
  users: TestUserCredential[];
};

export function generateTestUserPassword(): string {
  return randomBytes(32).toString("base64url");
}

function credentialStagingPrefix(filePath: string, targetDatabase: string) {
  const binding = createHash("sha256")
    .update(path.resolve(filePath))
    .update("\0")
    .update(targetDatabase)
    .digest("hex");
  return `.${path.basename(filePath)}.pending.${binding}.`;
}

export function credentialStagingFilePath(
  filePath: string,
  targetDatabase: string,
  processId: number,
  nonce: string,
): string {
  if (
    !path.isAbsolute(filePath) ||
    path.resolve(filePath) !== filePath ||
    !Number.isSafeInteger(processId) ||
    processId <= 0 ||
    !/^[0-9a-f]{32}$/.test(nonce)
  ) {
    throw new Error("Credential staging identity is invalid.");
  }
  return path.join(
    path.dirname(filePath),
    `${credentialStagingPrefix(filePath, targetDatabase)}${processId}.${nonce}`,
  );
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function repositoryRoots(cwd: string): string[] {
  const roots = new Set<string>();
  const current = execFileSync(
    "git",
    ["-C", cwd, "rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
  roots.add(path.resolve(current));
  const worktrees = execFileSync(
    "git",
    ["-C", current, "worktree", "list", "--porcelain"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  for (const line of worktrees.split("\n")) {
    if (line.startsWith("worktree ")) roots.add(path.resolve(line.slice(9)));
  }
  return [...roots];
}

async function assertNoSymlinkComponents(absolutePath: string): Promise<void> {
  const parsed = path.parse(absolutePath);
  let cursor = parsed.root;
  for (const component of absolutePath
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink())
        throw new Error("Credential path must not contain symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function validateCredentialFilePath(
  value: string,
  cwd = process.cwd(),
): Promise<string> {
  if (!path.isAbsolute(value))
    throw new Error("Credential file path must be absolute.");
  const absolute = path.resolve(value);
  await assertNoSymlinkComponents(absolute);

  for (const root of repositoryRoots(cwd)) {
    if (isWithin(root, absolute))
      throw new Error(
        "Credential file must be outside every repository worktree.",
      );
  }

  let containingRoot: string | undefined;
  let cursor = path.dirname(absolute);
  while (!containingRoot && cursor !== path.dirname(cursor)) {
    try {
      containingRoot = execFileSync(
        "git",
        ["-C", cursor, "rev-parse", "--show-toplevel"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
    } catch {
      cursor = path.dirname(cursor);
    }
  }
  if (containingRoot && isWithin(path.resolve(containingRoot), absolute)) {
    throw new Error("Credential file must be outside every Git repository.");
  }

  const parent = path.dirname(absolute);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(absolute);
  const actualParent = await realpath(parent);
  if (actualParent !== parent)
    throw new Error(
      "Credential directory path must not resolve through aliases.",
    );
  const parentInfo = await stat(parent);
  if (
    (parentInfo.mode & 0o777) !== 0o700 ||
    (process.getuid && parentInfo.uid !== process.getuid())
  ) {
    throw new Error(
      "Credential directory must be owned by the current user and mode 0700.",
    );
  }
  return absolute;
}

export async function readCredentialFile(
  filePath: string,
  targetDatabase: string,
  expected: readonly Pick<
    TestUserCredential,
    "role" | "email" | "scope" | "authentication"
  >[],
): Promise<TestUserCredentialManifest | null> {
  const parent = path.dirname(filePath);
  let credentialHandle: Awaited<ReturnType<typeof open>> | undefined;
  let content: string;
  try {
    credentialHandle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    let info = await credentialHandle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
      throw new Error(
        "Existing credential file must be a regular mode-0600 file.",
      );
    }
    if (info.nlink !== 1) {
      const pending = await findPublishedTemporaryLink(
        filePath,
        info,
        targetDatabase,
      );
      if (info.nlink !== 2 || !pending) {
        throw new Error("Existing credential file must not be hard-linked.");
      }
      await unlink(pending);
      await syncDirectory(parent);
      info = await credentialHandle.stat();
      if (info.nlink !== 1) {
        throw new Error("Existing credential file must not be hard-linked.");
      }
    }
    await cleanStaleCredentialStages(filePath, targetDatabase);
    content = await credentialHandle.readFile("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await cleanStaleCredentialStages(filePath, targetDatabase);
      return null;
    }
    throw error;
  } finally {
    await credentialHandle?.close();
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Existing credential file is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "Existing credential file does not match the requested test users.",
    );
  }
  const manifest = value as TestUserCredentialManifest;
  if (
    manifest.formatVersion !== 1 ||
    manifest.targetDatabase !== targetDatabase ||
    !Array.isArray(manifest.users) ||
    manifest.users.length !== expected.length
  ) {
    throw new Error(
      "Existing credential file does not match the requested test users.",
    );
  }
  for (const [index, item] of manifest.users.entries()) {
    const target = expected[index];
    if (
      !target ||
      !item ||
      typeof item !== "object" ||
      item.role !== target.role ||
      item.email !== target.email ||
      item.authentication !== target.authentication ||
      item.scope?.kind !== target.scope.kind ||
      item.scope?.scopeId !== target.scope.scopeId ||
      (item.authentication === "local_password" &&
        (typeof item.password !== "string" || item.password.length < 32)) ||
      (item.authentication === "external_provider_required" &&
        item.password !== null)
    ) {
      throw new Error(
        "Existing credential file does not match the requested test users.",
      );
    }
  }
  return manifest;
}

export async function writeCredentialFile(
  filePath: string,
  manifest: TestUserCredentialManifest,
): Promise<void> {
  const validatedPath = await validateCredentialFilePath(filePath);
  if (validatedPath !== filePath) {
    throw new Error("Credential file path must be absolute and normalized.");
  }
  const parent = path.dirname(filePath);
  const parentInfo = await stat(parent);
  if (
    (parentInfo.mode & 0o777) !== 0o700 ||
    (process.getuid && parentInfo.uid !== process.getuid())
  ) {
    throw new Error(
      "Credential directory must be owned by the current user and mode 0700.",
    );
  }
  await cleanStaleCredentialStages(filePath, manifest.targetDatabase);

  try {
    await lstat(filePath);
    throw new Error("Credential file already exists; it will not be replaced.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporaryPath = credentialStagingFilePath(
    filePath,
    manifest.targetDatabase,
    process.pid,
    randomBytes(16).toString("hex"),
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryIdentity: { dev: number; ino: number } | undefined;
  let published = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    const temporaryInfo = await handle.stat();
    temporaryIdentity = { dev: temporaryInfo.dev, ino: temporaryInfo.ino };
    if (
      !temporaryInfo.isFile() ||
      (temporaryInfo.mode & 0o777) !== 0o600 ||
      (process.getuid && temporaryInfo.uid !== process.getuid())
    ) {
      throw new Error("Private credential staging file could not be verified.");
    }
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;

    // `link` publishes the already-complete file atomically and fails with
    // EEXIST instead of replacing a credential file another process created.
    await link(temporaryPath, filePath);
    published = true;
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const targetInfo = await lstat(filePath);
      if (
        !temporaryIdentity ||
        targetInfo.dev !== temporaryIdentity.dev ||
        targetInfo.ino !== temporaryIdentity.ino ||
        targetInfo.nlink !== 1
      ) {
        throw error;
      }
    }
    await syncDirectory(parent);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await cleanupIfOwned(temporaryPath, temporaryIdentity);
    if (published) await cleanupIfOwned(filePath, temporaryIdentity);
    throw error;
  }
}

async function findPublishedTemporaryLink(
  filePath: string,
  targetInfo: Awaited<ReturnType<typeof lstat>>,
  targetDatabase: string,
): Promise<string | undefined> {
  const parent = path.dirname(filePath);
  const prefix = credentialStagingPrefix(filePath, targetDatabase);
  const names = await readdir(parent);
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    if (!/^\d+\.[0-9a-f]{32}$/.test(name.slice(prefix.length))) continue;
    const candidate = path.join(parent, name);
    const info = await lstat(candidate);
    if (
      info.isFile() &&
      !info.isSymbolicLink() &&
      (info.mode & 0o777) === 0o600 &&
      (!process.getuid || info.uid === process.getuid()) &&
      info.dev === targetInfo.dev &&
      info.ino === targetInfo.ino
    ) {
      return candidate;
    }
  }
  return undefined;
}

async function cleanStaleCredentialStages(
  filePath: string,
  targetDatabase: string,
): Promise<void> {
  const parent = path.dirname(filePath);
  const prefix = credentialStagingPrefix(filePath, targetDatabase);
  const names = await readdir(parent);
  let removed = false;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(\d+)\.([0-9a-f]{32})$/.exec(name.slice(prefix.length));
    if (!match?.[1]) continue;
    const processId = Number(match[1]);
    if (!Number.isSafeInteger(processId) || processId <= 0) continue;
    const stagedPath = path.join(parent, name);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(stagedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (isProcessAlive(processId)) continue;
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (info.mode & 0o777) !== 0o600 ||
      (process.getuid && info.uid !== process.getuid()) ||
      info.nlink !== 1
    ) {
      throw new Error(
        "Stale credential staging file failed private-file verification.",
      );
    }
    await unlink(stagedPath);
    removed = true;
  }
  if (removed) await syncDirectory(parent);
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH" && code !== "EINVAL";
  }
}

async function cleanupIfOwned(
  filePath: string,
  identity: { dev: number; ino: number } | undefined,
): Promise<void> {
  if (!identity) return;
  try {
    const info = await lstat(filePath);
    if (
      info.isFile() &&
      !info.isSymbolicLink() &&
      info.dev === identity.dev &&
      info.ino === identity.ino
    ) {
      await unlink(filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

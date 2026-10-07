import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
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
  try {
    const info = await lstat(filePath);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (info.mode & 0o777) !== 0o600
    ) {
      throw new Error(
        "Existing credential file must be a regular mode-0600 file.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
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
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILT_IN_ROLE_KEYS, BUILT_IN_ROLES } from "@taskdesk/permissions";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectedTestUserCredentials,
  formatTestUserSeedResult,
  parseTestUserRoles,
  SUPPORTED_TEST_USER_ROLES,
  supportedRoleInventory,
  workspaceScopedTestUserRoles,
} from "./seed-test-users";
import {
  credentialStagingFilePath,
  generateTestUserPassword,
  readCredentialFile,
  validateCredentialFilePath,
  writeCredentialFile,
} from "./test-user-credentials";

const temporaryDirectories: string[] = [];

async function privateTempDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-seed-users-"),
  );
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  return realpath(directory);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function exitedProcessId(): number {
  for (
    let candidate = 2_000_000_000;
    candidate < 2_000_000_100;
    candidate += 1
  ) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || code === "EINVAL") return candidate;
    }
  }
  throw new Error("Could not find an exited process id for the recovery test.");
}

describe("test-user seed contract", () => {
  it("covers the canonical roles and exposes only real current grant sources", () => {
    const inventory = supportedRoleInventory();
    expect(inventory.canonical).toEqual(BUILT_IN_ROLE_KEYS);
    expect(inventory.supported).toEqual(SUPPORTED_TEST_USER_ROLES);
    expect(inventory.supported).toEqual(BUILT_IN_ROLE_KEYS);
    expect(inventory.unavailable).toEqual([]);
    expect(inventory.planned).toEqual([]);
    expect(workspaceScopedTestUserRoles(SUPPORTED_TEST_USER_ROLES)).toEqual(
      BUILT_IN_ROLE_KEYS.filter(
        (role) => BUILT_IN_ROLES[role].scope === "workspace",
      ),
    );
  });

  it("accepts every canonical role and rejects duplicate role requests", () => {
    expect(parseTestUserRoles(undefined)).toEqual(BUILT_IN_ROLE_KEYS);
    expect(parseTestUserRoles("manager,lead")).toEqual(["manager", "lead"]);
    expect(
      parseTestUserRoles(
        "customer,viewer,lead,manager,member,admin,owner,instance_admin",
      ),
    ).toEqual(BUILT_IN_ROLE_KEYS);
    expect(() => parseTestUserRoles("viewer,viewer")).toThrow(/duplicate/);
  });

  it("reflects existing customer password-provider scope without making it a default", () => {
    const roles = [...SUPPORTED_TEST_USER_ROLES];
    const defaults = expectedTestUserCredentials(roles, false);
    expect(
      defaults.find((credential) => credential.role === "customer"),
    ).toMatchObject({
      authentication: "external_provider_required",
      scope: {
        kind: "organisation",
        scopeId: "taskdesk-test-user-customer-organisation",
      },
    });
    const enabledByExistingConfiguration = expectedTestUserCredentials(
      roles,
      true,
    );
    expect(
      enabledByExistingConfiguration.find(
        (credential) => credential.role === "customer",
      ),
    ).toMatchObject({ authentication: "local_password" });
  });

  it("creates distinct high-entropy random passwords", () => {
    const passwords = new Set(
      Array.from({ length: 8 }, generateTestUserPassword),
    );
    expect(passwords.size).toBe(8);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThanOrEqual(32);
    }
  });

  it("writes and reuses credentials only in a private create-only file", async () => {
    const directory = await privateTempDirectory();
    const target = path.join(directory, "roles.json");
    const credentials = [
      {
        role: "viewer",
        email: "taskdesk-test-user+viewer@taskdesk-test.invalid",
        password: generateTestUserPassword(),
        authentication: "local_password" as const,
        scope: {
          kind: "workspace",
          scopeId: "taskdesk-seed-minimal-workspace",
        },
      },
      {
        role: "customer",
        email: "taskdesk-test-user+customer@taskdesk-test.invalid",
        password: null,
        authentication: "external_provider_required" as const,
        scope: {
          kind: "organisation",
          scopeId: "taskdesk-test-user-customer-organisation",
        },
      },
    ];

    const manifest = {
      formatVersion: 1 as const,
      targetDatabase: "taskdesk_test",
      users: credentials,
    };
    await writeCredentialFile(target, manifest);
    const loaded = await readCredentialFile(
      target,
      "taskdesk_test",
      credentials,
    );
    expect(loaded).toEqual(manifest);
    await expect(writeCredentialFile(target, manifest)).rejects.toThrow();
    const contents = await readFile(target, "utf8");
    expect(contents).toContain(credentials[0]?.password);
  });

  it("rejects paths inside the repository and any symlinked credential path", async () => {
    const repositoryFile = path.resolve(
      process.cwd(),
      "apps/api/scripts/test-users.md",
    );
    await expect(validateCredentialFilePath(repositoryFile)).rejects.toThrow(
      /outside every repository worktree/,
    );

    const directory = await privateTempDirectory();
    const realDirectory = path.join(directory, "real");
    const linkedDirectory = path.join(directory, "linked");
    await mkdir(realDirectory, { mode: 0o700 });
    await symlink(realDirectory, linkedDirectory);
    await expect(
      validateCredentialFilePath(
        path.join(linkedDirectory, "credentials.json"),
      ),
    ).rejects.toThrow(/symlinks/);
  });

  it("rejects existing manifests with an unrelated hard link", async () => {
    const directory = await privateTempDirectory();
    const target = path.join(directory, "roles.json");
    const linkedCopy = path.join(directory, "linked-copy.json");
    const expected = expectedTestUserCredentials(["viewer"], false);
    const [expectedViewer] = expected;
    if (!expectedViewer)
      throw new Error("Expected viewer credential is missing.");
    const manifest = {
      formatVersion: 1 as const,
      targetDatabase: "taskdesk_test",
      users: [
        {
          ...expectedViewer,
          password: generateTestUserPassword(),
        },
      ],
    };
    await writeCredentialFile(target, manifest);
    await link(target, linkedCopy);
    await expect(
      readCredentialFile(target, "taskdesk_test", expected),
    ).rejects.toThrow(/must not be hard-linked/);
  });

  it("recovers a synced prepublication manifest and a crash after atomic publication", async () => {
    const directory = await privateTempDirectory();
    const target = path.join(directory, "roles.json");
    const expected = expectedTestUserCredentials(["viewer"], false);
    const [expectedViewer] = expected;
    if (!expectedViewer)
      throw new Error("Expected viewer credential is missing.");
    const manifest = {
      formatVersion: 1 as const,
      targetDatabase: "taskdesk_test",
      users: [
        {
          ...expectedViewer,
          password: generateTestUserPassword(),
        },
      ],
    };

    const crashedWriter = exitedProcessId();
    const staleStage = credentialStagingFilePath(
      target,
      "taskdesk_test",
      crashedWriter,
      "c".repeat(32),
    );
    const staleStageHandle = await open(staleStage, "wx", 0o600);
    await staleStageHandle.writeFile(JSON.stringify(manifest), "utf8");
    await staleStageHandle.sync();
    await staleStageHandle.close();

    const unrelatedTargetStage = credentialStagingFilePath(
      target,
      "another_test",
      crashedWriter,
      "d".repeat(32),
    );
    const unrelatedHandle = await open(unrelatedTargetStage, "wx", 0o600);
    await unrelatedHandle.writeFile("preserve this unrelated file", "utf8");
    await unrelatedHandle.close();
    expect(
      await readCredentialFile(target, "taskdesk_test", expected),
    ).toBeNull();
    await expect(lstat(staleStage)).rejects.toThrow();
    await expect(readFile(unrelatedTargetStage, "utf8")).resolves.toBe(
      "preserve this unrelated file",
    );
    await writeCredentialFile(target, manifest);
    expect(await readCredentialFile(target, "taskdesk_test", expected)).toEqual(
      manifest,
    );

    const publishedStage = credentialStagingFilePath(
      target,
      "taskdesk_test",
      crashedWriter,
      "a".repeat(32),
    );
    await link(target, publishedStage);
    expect(await readCredentialFile(target, "taskdesk_test", expected)).toEqual(
      manifest,
    );
    const handle = await open(target, "r");
    try {
      expect((await handle.stat()).nlink).toBe(1);
    } finally {
      await handle.close();
    }

    const activePublisherStage = credentialStagingFilePath(
      target,
      "taskdesk_test",
      process.pid,
      "b".repeat(32),
    );
    await link(target, activePublisherStage);
    expect(await readCredentialFile(target, "taskdesk_test", expected)).toEqual(
      manifest,
    );
    const activePublisherHandle = await open(target, "r");
    try {
      expect((await activePublisherHandle.stat()).nlink).toBe(1);
    } finally {
      await activePublisherHandle.close();
    }
    await expect(lstat(activePublisherStage)).rejects.toThrow();
  });

  it("keeps the success output independent from password values", () => {
    const password = generateTestUserPassword();
    const output = formatTestUserSeedResult(
      8,
      "taskdesk_local_test",
      "/private/test-users.json",
    );
    expect(output).not.toContain(password);
    expect(output).toContain("8 test users");
  });
});

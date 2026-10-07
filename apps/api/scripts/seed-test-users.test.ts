import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILT_IN_ROLE_KEYS } from "@taskdesk/permissions";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectedTestUserCredentials,
  formatTestUserSeedResult,
  parseTestUserRoles,
  SUPPORTED_TEST_USER_ROLES,
  supportedRoleInventory,
} from "./seed-test-users";
import {
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
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("test-user seed contract", () => {
  it("covers the canonical roles and exposes only real current grant sources", () => {
    const inventory = supportedRoleInventory();
    expect(inventory.canonical).toEqual(BUILT_IN_ROLE_KEYS);
    expect(inventory.supported).toEqual(SUPPORTED_TEST_USER_ROLES);
    expect(inventory.unavailable).toEqual(["manager", "lead"]);
    expect(inventory.planned).toEqual(["manager", "lead"]);
  });

  it("rejects roles without current producers and duplicate role requests", () => {
    expect(() => parseTestUserRoles("manager")).toThrow(
      /no supported test-user grant source/,
    );
    expect(() => parseTestUserRoles("lead")).toThrow(
      /no supported test-user grant source/,
    );
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

  it("creates distinct random passwords accepted by Better Auth's password verifier", async () => {
    const passwords = new Set(
      Array.from({ length: 6 }, generateTestUserPassword),
    );
    expect(passwords.size).toBe(6);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThanOrEqual(32);
      expect(
        await verifyPassword({ hash: await hashPassword(password), password }),
      ).toBe(true);
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

  it("keeps the success output independent from password values", () => {
    const password = generateTestUserPassword();
    const output = formatTestUserSeedResult(
      6,
      "taskdesk_local_test",
      "/private/test-users.json",
    );
    expect(output).not.toContain(password);
    expect(output).toContain("6 test users");
  });
});

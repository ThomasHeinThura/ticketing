import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeedProfile } from "../../../tests/fixtures/seed-profiles";
import { loadConfiguredSeedProfile } from "./seed-cli";

const databaseKeys = [
  "TASKDESK_DATABASE_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
] as const;

type SeedProfileModule = typeof import("./seed-profile");

const stubSeedModule: SeedProfileModule = {
  seed: async (_profile: SeedProfile) => {},
  runSeedCli: async () => {},
};

// Most tests control process.env directly. Do not load the developer's real
// monorepo .env over those deliberately empty fixtures.
const skipEnvironmentLoad = () => {};

describe("seed CLI database configuration preflight", () => {
  beforeEach(() => {
    for (const key of databaseKeys) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the local fallback before importing the DB-backed profile", async () => {
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(
      loadConfiguredSeedProfile(loadProfile, skipEnvironmentLoad),
    ).rejects.toThrow(
      "Seed requires an explicitly configured database. Set TASKDESK_DATABASE_URL",
    );
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it("loads the seed profile for an explicit TASKDESK_DATABASE_URL", async () => {
    vi.stubEnv(
      "TASKDESK_DATABASE_URL",
      "postgresql://db.example.invalid:5432/taskdesk_test",
    );
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(
      loadConfiguredSeedProfile(loadProfile, skipEnvironmentLoad),
    ).resolves.toBe(stubSeedModule);
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("loads the existing dotenv environment before resolving and importing the profile", async () => {
    const order: string[] = [];
    const loadProfile = vi.fn(async () => {
      order.push("profile");
      return stubSeedModule;
    });
    const loadEnvironment = vi.fn(() => {
      order.push("dotenv-mono");
      vi.stubEnv(
        "TASKDESK_DATABASE_URL",
        "postgresql://db.example.invalid:5432/taskdesk_test",
      );
    });

    await expect(
      loadConfiguredSeedProfile(loadProfile, loadEnvironment),
    ).resolves.toBe(stubSeedModule);
    expect(order).toEqual(["dotenv-mono", "profile"]);
    expect(loadEnvironment).toHaveBeenCalledOnce();
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("sanitizes malformed credential-bearing URLs before CLI logging", async () => {
    const url = new URL("postgresql://db.example.invalid:5432/taskdesk_test");
    url.username = "seed";
    url.password = randomBytes(24).toString("hex");
    const malformedUrl = url.href.replace("db.example.invalid", "[");
    vi.stubEnv("TASKDESK_DATABASE_URL", malformedUrl);
    const loadProfile = vi.fn(async () => stubSeedModule);

    let caught: unknown;
    try {
      await loadConfiguredSeedProfile(loadProfile, () => {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "Seed database URL configuration is invalid.",
    );
    expect(String(caught)).not.toContain(url.password);
    expect(caught).not.toHaveProperty("input");
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it("loads the seed profile for the resolver's POSTGRES_ENV source", async () => {
    vi.stubEnv("POSTGRES_PASSWORD", "test-only-password");
    vi.stubEnv("POSTGRES_HOST", "db.example.invalid");
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(
      loadConfiguredSeedProfile(loadProfile, skipEnvironmentLoad),
    ).resolves.toBe(stubSeedModule);
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("preserves the resolver's incomplete POSTGRES configuration error", async () => {
    vi.stubEnv("POSTGRES_HOST", "db.example.invalid");
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(
      loadConfiguredSeedProfile(loadProfile, skipEnvironmentLoad),
    ).rejects.toThrow(
      "POSTGRES_PASSWORD must be set when deriving TASKDESK_DATABASE_URL",
    );
    expect(loadProfile).not.toHaveBeenCalled();
  });
});

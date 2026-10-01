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

type DatabaseKey = (typeof databaseKeys)[number];
type SeedProfileModule = typeof import("./seed-profile");

const originalEnvironment = new Map<DatabaseKey, string | undefined>();
const stubSeedModule: SeedProfileModule = {
  seed: async (_profile: SeedProfile) => {},
  runSeedCli: async () => {},
};

describe("seed CLI database configuration preflight", () => {
  beforeEach(() => {
    originalEnvironment.clear();
    for (const key of databaseKeys) {
      originalEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of databaseKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("refuses the local fallback before importing the DB-backed profile", async () => {
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(loadConfiguredSeedProfile(loadProfile)).rejects.toThrow(
      "Seed requires an explicitly configured database. Set TASKDESK_DATABASE_URL",
    );
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it("loads the seed profile for an explicit TASKDESK_DATABASE_URL", async () => {
    process.env.TASKDESK_DATABASE_URL =
      "postgresql://seed:test@db.example.invalid:5432/taskdesk_test";
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(loadConfiguredSeedProfile(loadProfile)).resolves.toBe(
      stubSeedModule,
    );
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
      process.env.TASKDESK_DATABASE_URL =
        "postgresql://seed:test@db.example.invalid:5432/taskdesk_test";
    });

    await expect(
      loadConfiguredSeedProfile(loadProfile, loadEnvironment),
    ).resolves.toBe(stubSeedModule);
    expect(order).toEqual(["dotenv-mono", "profile"]);
    expect(loadEnvironment).toHaveBeenCalledOnce();
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("sanitizes malformed credential-bearing URLs before CLI logging", async () => {
    const secret = "SYNTHETIC_SEED_URL_SECRET";
    process.env.TASKDESK_DATABASE_URL = `postgresql://seed:${secret}@[invalid`;
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
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(loadProfile).not.toHaveBeenCalled();
  });

  it("loads the seed profile for the resolver's POSTGRES_ENV source", async () => {
    process.env.POSTGRES_PASSWORD = "test-only-password";
    process.env.POSTGRES_HOST = "db.example.invalid";
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(loadConfiguredSeedProfile(loadProfile)).resolves.toBe(
      stubSeedModule,
    );
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("preserves the resolver's incomplete POSTGRES configuration error", async () => {
    process.env.POSTGRES_HOST = "db.example.invalid";
    const loadProfile = vi.fn(async () => stubSeedModule);

    await expect(loadConfiguredSeedProfile(loadProfile)).rejects.toThrow(
      "POSTGRES_PASSWORD must be set when deriving TASKDESK_DATABASE_URL",
    );
    expect(loadProfile).not.toHaveBeenCalled();
  });
});

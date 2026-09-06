import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveDatabaseConfig,
  resolveDatabaseConnectionString,
} from "../../../apps/api/src/database/resolve-database-url";

const keys = [
  "TASKDESK_DATABASE_URL",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
] as const;

describe("resolve-database-url", () => {
  const original: Partial<Record<(typeof keys)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of keys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns TASKDESK_DATABASE_URL unchanged when explicitly configured", () => {
    process.env.TASKDESK_DATABASE_URL =
      "postgresql://app:secret@example.com:5433/appdb";

    expect(resolveDatabaseConnectionString()).toBe(
      "postgresql://app:secret@example.com:5433/appdb",
    );

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://app:secret@example.com:5433/appdb",
      source: "TASKDESK_DATABASE_URL",
      host: "example.com",
      port: 5433,
      database: "appdb",
      username: "app",
    });
  });

  it("derives TASKDESK_DATABASE_URL from POSTGRES_* when a derivation signal is present", () => {
    process.env.POSTGRES_PASSWORD = "password";
    process.env.POSTGRES_HOST = "db.internal";
    process.env.POSTGRES_PORT = "6543";
    process.env.POSTGRES_DB = "taskdesk_dev";
    process.env.POSTGRES_USER = "taskdesk";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString:
        "postgresql://taskdesk:password@db.internal:6543/taskdesk_dev",
      source: "POSTGRES_ENV",
      host: "db.internal",
      port: 6543,
      database: "taskdesk_dev",
      username: "taskdesk",
    });
  });

  it("uses bundled-image defaults when deriving from POSTGRES_PASSWORD alone", () => {
    process.env.POSTGRES_PASSWORD = "password";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://taskdesk:password@postgres:5432/taskdesk",
      source: "POSTGRES_ENV",
      host: "postgres",
      port: 5432,
      database: "taskdesk",
      username: "taskdesk",
    });
  });

  it("preserves the localhost fallback when only POSTGRES_DB and POSTGRES_USER are set", () => {
    process.env.POSTGRES_DB = "taskdesk";
    process.env.POSTGRES_USER = "taskdesk";

    expect(resolveDatabaseConfig()).toMatchObject({
      connectionString: "postgresql://localhost:5432/taskdesk",
      source: "LOCAL_FALLBACK",
      host: "localhost",
      port: 5432,
      database: "taskdesk",
      username: "",
    });
  });

  it("throws when derivation is attempted without POSTGRES_PASSWORD", () => {
    process.env.POSTGRES_HOST = "db.internal";

    expect(() => resolveDatabaseConfig()).toThrow(
      "POSTGRES_PASSWORD must be set when deriving TASKDESK_DATABASE_URL from POSTGRES_* variables",
    );
  });

  it("exposes safe metadata without a password field", () => {
    process.env.POSTGRES_PASSWORD = "super-secret";

    const config = resolveDatabaseConfig();

    expect(config.logConfig).not.toHaveProperty("password");
    expect(JSON.stringify(config.logConfig)).not.toContain("super-secret");
  });
});

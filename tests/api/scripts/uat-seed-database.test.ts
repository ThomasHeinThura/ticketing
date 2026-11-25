import { afterEach, describe, expect, it, vi } from "vitest";
import { assertUatSeedDatabase } from "../../../apps/api/scripts/seed-uat-users";
import { getDatabasePool } from "../../../apps/api/src/database";

describe("seed database safety before connection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [
      undefined,
      { port: 5432, database: "any_db" },
      "UAT seed refused: set TASKDESK_SEED_CONFIRM_DATABASE=any_db to confirm this is the database to seed.",
    ],
    [
      "other_db",
      { port: 5432, database: "any_db" },
      "UAT seed refused: set TASKDESK_SEED_CONFIRM_DATABASE=any_db to confirm this is the database to seed.",
    ],
    [
      "taskdesk_browser_journey_1022_test",
      { port: 1, database: "taskdesk_browser_journey_1022_test" },
      "UAT seed refused: taskdesk_browser_journey_1022_test is the live database and must never be seeded.",
    ],
  ] as const)(
    "refuses confirm=%s for %j without connecting",
    (confirm, database, message) => {
      vi.stubEnv("TASKDESK_SEED_CONFIRM_DATABASE", confirm);
      const connect = vi.spyOn(getDatabasePool(), "connect");
      try {
        expect(() => assertUatSeedDatabase(database)).toThrowError(
          new Error(message),
        );
        expect(connect).not.toHaveBeenCalled();
      } finally {
        connect.mockRestore();
      }
    },
  );

  it("accepts a database the operator named", () => {
    vi.stubEnv("TASKDESK_SEED_CONFIRM_DATABASE", "any_db");
    expect(() =>
      assertUatSeedDatabase({ port: 5432, database: "any_db" }),
    ).not.toThrow();
  });
});

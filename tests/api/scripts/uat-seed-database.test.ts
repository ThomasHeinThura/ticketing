import { describe, expect, it, vi } from "vitest";
import { assertUatSeedDatabase } from "../../../apps/api/scripts/seed-uat-users";
import { getDatabasePool } from "../../../apps/api/src/database";

describe("seed database safety before connection", () => {
  it.each([
    [
      { port: 62870, database: "unused_test" },
      "UAT seed refused: native PostgreSQL port 62870 is protected.",
    ],
    [
      { port: 1, database: "taskdesk_browser_journey_1022_test" },
      "UAT seed refused: taskdesk_browser_journey_1022_test is the live database and must never be seeded.",
    ],
  ] as const)("refuses %j without connecting", (database, message) => {
    const connect = vi.spyOn(getDatabasePool(), "connect");
    try {
      expect(() => assertUatSeedDatabase(database)).toThrowError(
        new Error(message),
      );
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
});

import { describe, expect, it } from "vitest";
import { assertNoMigrationUrlInApiProcess } from "../../../apps/api/src/database/assert-no-migration-url-in-api-process";

/**
 * Issue #296, S1 (independent Opus 5.5 review of PR #308, BLOCKING): "Add a test" for the
 * serving process's structural refusal when `TASKDESK_MIGRATION_DATABASE_URL` is present in
 * its own environment. A pure function taking the value itself as a parameter, so this needs
 * no `process.env` mutation/restoration.
 */
describe("assertNoMigrationUrlInApiProcess", () => {
  it("does not throw when the value is undefined", () => {
    expect(() => assertNoMigrationUrlInApiProcess(undefined)).not.toThrow();
  });

  it("throws when the value is present", () => {
    expect(() =>
      assertNoMigrationUrlInApiProcess(
        "postgresql://taskdesk:pw@postgres:5432/taskdesk",
      ),
    ).toThrow(/TASKDESK_MIGRATION_DATABASE_URL/);
  });

  it("names issue #296 in the refusal", () => {
    expect(() =>
      assertNoMigrationUrlInApiProcess(
        "postgresql://taskdesk:pw@postgres:5432/taskdesk",
      ),
    ).toThrow(/issue #296/);
  });

  it("does not throw for an empty string (Compose/Helm never set it to empty; an absent variable is the real signal)", () => {
    expect(() => assertNoMigrationUrlInApiProcess("")).not.toThrow();
  });
});

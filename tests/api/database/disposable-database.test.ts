import { describe, expect, it } from "vitest";
import { assertDisposableTestDatabaseUrl } from "../../api-integration/helpers/disposable-database";

describe("disposable integration database guard", () => {
  it.each(["62870", "62871", "5432"])(
    "rejects the live test-suffixed database on port %s",
    (port) => {
      expect(() =>
        assertDisposableTestDatabaseUrl(
          `postgresql://localhost:${port}/taskdesk_browser_journey_1022_test`,
        ),
      ).toThrow("protected");
    },
  );
  it("also rejects an encoded live name and ordinary customer databases", () => {
    for (const name of [
      "%74askdesk_browser_journey_1022_test",
      "taskdesk_live_copy",
      "taskdesk_codex_sit_20261025",
    ])
      expect(() =>
        assertDisposableTestDatabaseUrl(`postgresql://localhost/${name}`),
      ).toThrow("protected");
  });
  it("allows an explicitly disposable worktree database", () => {
    expect(
      assertDisposableTestDatabaseUrl(
        "postgresql://localhost/taskdesk_codex_identity_rate_20261025_test",
      ),
    ).toBe("taskdesk_codex_identity_rate_20261025_test");
  });
});

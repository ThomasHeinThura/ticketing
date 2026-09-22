import { describe, expect, it } from "vitest";
import {
  deriveWorktreeTestDatabaseName,
  deriveWorktreeTestDatabaseUrl,
  sanitizeWorktreeSegment,
} from "../../api-integration/helpers/worktree-database-name";

describe("worktree-database-name", () => {
  describe("sanitizeWorktreeSegment", () => {
    it("lowercases a normal worktree name unchanged", () => {
      expect(sanitizeWorktreeSegment("lane-a")).toBe("lane_a");
    });

    it("replaces special characters with underscores and collapses runs", () => {
      expect(
        sanitizeWorktreeSegment("feat/113--Per Worktree!!Test_DB (2)"),
      ).toBe("feat_113_per_worktree_test_db_2");
    });

    it("strips leading and trailing separators produced by sanitising", () => {
      expect(sanitizeWorktreeSegment("--already-clean--")).toBe(
        "already_clean",
      );
    });

    it("falls back to a fixed segment when nothing alphanumeric survives", () => {
      expect(sanitizeWorktreeSegment("!!!")).toBe("default");
    });

    it("truncates a name that would exceed the Postgres identifier budget", () => {
      const veryLongName = "a".repeat(100);
      const sanitized = sanitizeWorktreeSegment(veryLongName);

      // taskdesk_ (9) + segment + _test (5) must stay comfortably under the
      // 63-byte NAMEDATALEN limit (#241).
      expect(sanitized.length).toBeLessThanOrEqual(63 - 9 - 5);
      expect(sanitized).toBe("a".repeat(sanitized.length));
    });

    it("does not leave a trailing underscore after truncation", () => {
      // 48 'a's then a separator that lands exactly on the 49-char
      // truncation boundary if not stripped afterwards.
      const name = `${"a".repeat(48)}_rest-of-a-very-long-worktree-name`;
      const sanitized = sanitizeWorktreeSegment(name);

      expect(sanitized.endsWith("_")).toBe(false);
      expect(sanitized).toBe("a".repeat(48));
    });
  });

  describe("deriveWorktreeTestDatabaseName", () => {
    it("wraps the sanitised basename in the taskdesk_..._test convention", () => {
      expect(
        deriveWorktreeTestDatabaseName("/home/ubuntu/worktrees/lane-a"),
      ).toBe("taskdesk_lane_a_test");
    });

    it("handles the exact case CI would hit if it ever ran without an explicit URL", () => {
      // GitHub Actions checks out pull_request/merge_group builds into a
      // directory literally named "ticketing" by default.
      expect(
        deriveWorktreeTestDatabaseName("/home/runner/work/ticketing"),
      ).toBe("taskdesk_ticketing_test");
    });

    it("never produces a name CI's explicit TASKDESK_DATABASE_URL wouldn't already satisfy", () => {
      // Whatever the derivation produces must still end in _test -- the
      // existing safety guard (tests/api-integration/helpers/database.ts)
      // refuses to touch a database whose name doesn't.
      const derived = deriveWorktreeTestDatabaseName(
        "/some/path/feature-branch-worktree",
      );
      expect(derived.endsWith("_test")).toBe(true);
    });
  });

  describe("deriveWorktreeTestDatabaseUrl", () => {
    it("builds a full connection string using the previous fixed host/port/credentials", () => {
      expect(
        deriveWorktreeTestDatabaseUrl("/home/ubuntu/worktrees/lane-a"),
      ).toBe(
        "postgresql://postgres:postgres@localhost:5432/taskdesk_lane_a_test",
      );
    });

    it("produces a URL whose database name the existing _test suffix guard accepts", () => {
      const url = deriveWorktreeTestDatabaseUrl("/weird/!!!/path");
      const databaseName = new URL(url).pathname.replace(/^\//, "");
      expect(databaseName.endsWith("_test")).toBe(true);
    });
  });
});

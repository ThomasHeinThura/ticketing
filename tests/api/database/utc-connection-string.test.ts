import { describe, expect, it } from "vitest";
import { withUtcDatabaseSession } from "../../../apps/api/src/database/utc-connection-string";

describe("UTC database sessions", () => {
  it("preserves connection parameters and overrides an earlier timezone", () => {
    const original = new URL("postgresql://app@localhost:5433/taskdesk");
    original.searchParams.set("sslmode", "verify-full");
    original.searchParams.set("application_name", "TaskDesk owner");
    original.searchParams.set(
      "options",
      "-c statement_timeout=5000 -c TimeZone=Asia/Yangon",
    );
    const resolved = new URL(withUtcDatabaseSession(original.toString()));
    expect(resolved.origin).toBe(original.origin);
    expect(resolved.username).toBe(original.username);
    expect(resolved.pathname).toBe(original.pathname);
    expect(resolved.searchParams.get("sslmode")).toBe("verify-full");
    expect(resolved.searchParams.get("application_name")).toBe(
      "TaskDesk owner",
    );
    expect(resolved.searchParams.get("options")).toBe(
      "-c statement_timeout=5000 -c TimeZone=Asia/Yangon -c TimeZone=UTC",
    );
  });
});

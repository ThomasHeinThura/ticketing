import { describe, expect, it, vi } from "vitest";
import {
  enforceStaffSessionCap,
  STAFF_SESSION_MAX_DAYS_MAX,
  STAFF_SESSION_MAX_DAYS_MIN,
} from "../../../apps/api/src/auth/session-lifetime";

vi.mock("../../../apps/api/src/auth/repository", () => ({}));
vi.mock("../../../apps/api/src/ws", () => ({
  invalidateNativeAuthorization: vi.fn(),
}));

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 25);

function run(portal: string, ageDays: number, maxDays = 30) {
  const revoke = vi.fn(async () => {});
  const rejected = enforceStaffSessionCap(
    {
      id: "s1",
      userId: "u1",
      portal,
      createdAt: new Date(now - ageDays * DAY),
    },
    { getMaxDays: async () => maxDays, revoke, now: () => now },
  );
  return { rejected, revoke };
}

describe("staff session absolute cap", () => {
  it("rejects and revokes a staff session created 31 days ago with a 30 day cap", async () => {
    const { rejected, revoke } = run("agent", 31);
    expect(await rejected).toBe(true);
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1", userId: "u1" }),
    );
  });

  it("accepts a staff session created 29 days ago", async () => {
    const { rejected, revoke } = run("agent", 29);
    expect(await rejected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("does not touch a portal session however old", async () => {
    const { rejected, revoke } = run("customer", 80);
    expect(await rejected).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("uses the configured cap", async () => {
    expect(await run("agent", 2, 1).rejected).toBe(true);
    expect(await run("agent", 80, 90).rejected).toBe(false);
  });

  it("allows 1 to 90 days", () => {
    expect([STAFF_SESSION_MAX_DAYS_MIN, STAFF_SESSION_MAX_DAYS_MAX]).toEqual([
      1, 90,
    ]);
  });
});

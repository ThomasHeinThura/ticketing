import { expect, it, vi } from "vitest";

const setting = vi.hoisted(() => ({ read: vi.fn<() => Promise<number>>() }));
vi.mock("../../../apps/api/src/auth/repository", () => ({
  deleteSessionById: vi.fn(),
  getStaffSessionMaxDaysSetting: setting.read,
}));
vi.mock("../../../apps/api/src/ws", () => ({
  invalidateNativeAuthorization: vi.fn(),
}));

import {
  enforceStaffSessionCap,
  resetStaffSessionCapCache,
} from "../../../apps/api/src/auth/session-lifetime";

it("does not cache a cap read that started before a reset", async () => {
  const session = {
    id: "s1",
    userId: "u1",
    portal: "agent",
    createdAt: new Date(Date.now() - 20 * 86_400_000),
  };
  let release: (days: number) => void = () => {};
  setting.read.mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  const inFlight = enforceStaffSessionCap(session, { revoke: vi.fn() });
  // The cap is lowered and saved while the old read is still pending.
  resetStaffSessionCapCache();
  release(30);
  expect(await inFlight).toBe(false);

  setting.read.mockResolvedValueOnce(10);
  expect(await enforceStaffSessionCap(session, { revoke: vi.fn() })).toBe(true);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const deleteSessionById = vi.fn(async () => undefined);
const getStaffSessionMaxDaysSetting = vi.fn(async () => 30);

vi.mock("../../../apps/api/src/auth", () => ({
  authForHost: vi.fn(() => ({ api: { getSession } })),
  hasCustomerPortalIdentity: vi.fn(async () => false),
  portalForHost: vi.fn(() => "agent"),
}));
vi.mock("../../../apps/api/src/auth/repository", () => ({
  deleteSessionById: (...a: unknown[]) => deleteSessionById(...(a as [])),
  getStaffSessionMaxDaysSetting: () => getStaffSessionMaxDaysSetting(),
}));
vi.mock("../../../apps/api/src/ws", () => ({
  invalidateNativeAuthorization: vi.fn(async () => undefined),
}));

import { resetStaffSessionCapCache } from "../../../apps/api/src/auth/session-lifetime";
import { resolveOptionalCookieSession } from "../../../apps/api/src/utils/authenticate-api-request";

const DAY = 86_400_000;
const session = (ageDays: number) => ({
  session: {
    id: "s1",
    userId: "u1",
    portal: "agent",
    createdAt: new Date(Date.now() - ageDays * DAY),
  },
  user: { id: "u1" },
});
const headers = new Headers({ host: "agent.example.test" });

describe("authenticate-api-request enforces the staff session cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStaffSessionCapCache();
  });

  it("treats an over-cap staff session as signed out and revokes it", async () => {
    getSession.mockResolvedValue(session(31));
    await expect(resolveOptionalCookieSession(headers)).resolves.toBeNull();
    expect(deleteSessionById).toHaveBeenCalledWith("s1");
  });

  it("keeps a session inside the cap", async () => {
    const inside = session(5);
    getSession.mockResolvedValue(inside);
    await expect(resolveOptionalCookieSession(headers)).resolves.toBe(inside);
    expect(deleteSessionById).not.toHaveBeenCalled();
  });
});

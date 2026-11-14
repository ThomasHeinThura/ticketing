import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as { enabled: boolean }[],
  fail: false,
}));
vi.mock("../../apps/api/src/database", () => ({
  default: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (mocks.fail) throw new Error("unavailable");
            return mocks.rows;
          },
        }),
      }),
    }),
  },
  schema: {
    instanceSettingTable: { id: {}, staffSelfRegistrationEnabled: {} },
  },
}));

import {
  refreshStaffRegistration,
  staffSelfRegistrationEnabled,
} from "../../apps/api/src/auth/staff-registration";

afterEach(() => {
  delete process.env.DISABLE_REGISTRATION;
  mocks.rows = [];
  mocks.fail = false;
});

describe("staff registration configuration", () => {
  it("defaults off and refreshes the cached setting", async () => {
    await refreshStaffRegistration();
    expect(staffSelfRegistrationEnabled()).toBe(false);
    mocks.rows = [{ enabled: true }];
    expect(staffSelfRegistrationEnabled()).toBe(false);
    await refreshStaffRegistration();
    expect(staffSelfRegistrationEnabled()).toBe(true);
    mocks.rows = [{ enabled: false }];
    await refreshStaffRegistration();
    expect(staffSelfRegistrationEnabled()).toBe(false);
  });

  it("fails closed when refresh fails", async () => {
    mocks.rows = [{ enabled: true }];
    await refreshStaffRegistration();
    mocks.fail = true;
    await expect(refreshStaffRegistration()).rejects.toThrow("unavailable");
    expect(staffSelfRegistrationEnabled()).toBe(false);
  });

  it("honours the environment force-off", async () => {
    mocks.rows = [{ enabled: true }];
    await refreshStaffRegistration();
    process.env.DISABLE_REGISTRATION = "true";
    expect(staffSelfRegistrationEnabled()).toBe(false);
  });
});

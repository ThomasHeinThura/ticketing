import { describe, expect, it } from "vitest";
import {
  memberRefusal,
  rosterEditAllowed,
  teamDeletionBlockers,
  validCapacity,
} from "../../../apps/api/src/team/logic";

describe("roster edit authority (TM-3)", () => {
  it("allows workspace:manage_settings", () => {
    expect(
      rosterEditAllowed({
        canManageSettings: true,
        isLeadOfTeam: false,
        credential: "api_key",
      }),
    ).toBe(true);
  });
  it("allows a lead of this team in a browser session", () => {
    expect(
      rosterEditAllowed({
        canManageSettings: false,
        isLeadOfTeam: true,
        credential: "session",
      }),
    ).toBe(true);
  });
  it("refuses a lead acting through an API key, and a non-lead without the capability", () => {
    expect(
      rosterEditAllowed({
        canManageSettings: false,
        isLeadOfTeam: true,
        credential: "api_key",
      }),
    ).toBe(false);
    expect(
      rosterEditAllowed({
        canManageSettings: false,
        isLeadOfTeam: false,
        credential: "session",
      }),
    ).toBe(false);
  });
});

describe("member eligibility (TM-2)", () => {
  const staff = { side: "staff", active: true, userId: "u1" };
  it("accepts an active staff workspace member", () => {
    expect(memberRefusal(staff, true)).toBeNull();
  });
  it("refuses customer-side, placeholder, deactivated and non-member people", () => {
    expect(memberRefusal({ ...staff, side: "customer" }, true)).toMatch(
      /staff/,
    );
    expect(memberRefusal({ ...staff, userId: null }, true)).toMatch(/sign-in/);
    expect(memberRefusal({ ...staff, active: false }, true)).toMatch(
      /deactivated/,
    );
    expect(memberRefusal(staff, false)).toMatch(/workspace/);
    expect(memberRefusal(undefined, true)).toMatch(/not found/);
  });
});

describe("team deletion (TM-7)", () => {
  it("refuses the CAB team and teams with shared views or projects", () => {
    expect(
      teamDeletionBlockers({
        isCab: false,
        sharedViewCount: 0,
        ownedProjectCount: 0,
      }),
    ).toEqual([]);
    expect(
      teamDeletionBlockers({
        isCab: true,
        sharedViewCount: 2,
        ownedProjectCount: 1,
      }),
    ).toHaveLength(3);
  });
});

describe("capacity", () => {
  it("accepts 0 to 7 in tenths and null", () => {
    expect(validCapacity(null)).toBe(true);
    expect(validCapacity(4.5)).toBe(true);
    expect(validCapacity(7.1)).toBe(false);
    expect(validCapacity(-1)).toBe(false);
    expect(validCapacity(2.55)).toBe(false);
  });
});

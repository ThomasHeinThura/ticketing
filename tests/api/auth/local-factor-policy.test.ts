import { describe, expect, it } from "vitest";
import {
  isLocalFactorRequired,
  parseLocalFactorPolicy,
} from "../../../apps/api/src/auth/local-factor-policy";

describe("local factor policy", () => {
  it("accepts only the closed persisted shape", () => {
    expect(
      parseLocalFactorPolicy({ mode: "optional", requiredRoleId: null }),
    ).toEqual({
      mode: "optional",
      requiredRoleId: null,
    });
    for (const value of [
      null,
      [],
      { mode: "required_role", requiredRoleId: null },
      { mode: "off", requiredRoleId: "role_1" },
      { mode: "required_everyone", requiredRoleId: null, extra: true },
    ]) {
      expect(() => parseLocalFactorPolicy(value)).toThrow(
        "Invalid local factor policy",
      );
    }
  });

  it("requires a verified local factor only for the configured population", () => {
    const requiredStaff = parseLocalFactorPolicy({
      mode: "required_staff",
      requiredRoleId: null,
    });
    expect(
      isLocalFactorRequired({
        policy: requiredStaff,
        personSide: "staff",
        activeRoleIds: [],
      }),
    ).toBe(true);
    expect(
      isLocalFactorRequired({
        policy: requiredStaff,
        personSide: "customer",
        activeRoleIds: [],
      }),
    ).toBe(false);

    const requiredRole = parseLocalFactorPolicy({
      mode: "required_role",
      requiredRoleId: "role_target",
    });
    expect(
      isLocalFactorRequired({
        policy: requiredRole,
        personSide: "staff",
        activeRoleIds: ["role_target"],
      }),
    ).toBe(true);
    expect(
      isLocalFactorRequired({
        policy: requiredRole,
        personSide: "staff",
        activeRoleIds: [],
      }),
    ).toBe(false);
  });

  it("never requires a local factor of a customer in any mode (P3-R1-04)", () => {
    for (const policy of [
      { mode: "off", requiredRoleId: null },
      { mode: "optional", requiredRoleId: null },
      { mode: "required_staff", requiredRoleId: null },
      { mode: "required_role", requiredRoleId: "role_target" },
      { mode: "required_everyone", requiredRoleId: null },
    ]) {
      expect(
        isLocalFactorRequired({
          policy: parseLocalFactorPolicy(policy),
          personSide: "customer",
          activeRoleIds: ["role_target"],
        }),
      ).toBe(false);
    }
    expect(
      isLocalFactorRequired({
        policy: parseLocalFactorPolicy({
          mode: "required_everyone",
          requiredRoleId: null,
        }),
        personSide: "staff",
        activeRoleIds: [],
      }),
    ).toBe(true);
  });
});

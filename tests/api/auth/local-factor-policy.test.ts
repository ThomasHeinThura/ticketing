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
});

import { describe, expect, it } from "vitest";
import {
  parseIdentityJitPolicy,
  validateEntraAdmission,
} from "./jit-policy.js";

describe("closed Entra JIT policy", () => {
  it("accepts the exact policy and preserves the Entra role value", () => {
    expect(
      parseIdentityJitPolicy({
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "  exact-role  ",
      }),
    ).toEqual({
      ok: true,
      value: {
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "  exact-role  ",
      },
    });
  });

  it.each([
    {},
    { enabled: true, default_role_id: null },
    {
      enabled: true,
      default_role_id: "role-1",
      required_entra_app_role: "role",
      extra: "secret",
    },
    {
      enabled: "true",
      default_role_id: "role-1",
      required_entra_app_role: "role",
    },
    {
      enabled: true,
      default_role_id: "",
      required_entra_app_role: "role",
    },
    {
      enabled: true,
      default_role_id: "role-1",
      required_entra_app_role: "",
    },
    null,
    [true, null, "role"],
  ])("refuses malformed or extra-field policy %#", (value) => {
    expect(parseIdentityJitPolicy(value)).toEqual({
      ok: false,
      reason: "invalid_shape",
    });
  });

  it("requires the exact configured app role and member-account claim", () => {
    const policy = {
      enabled: false,
      default_role_id: null,
      required_entra_app_role: "taskdesk.staff",
    };
    expect(
      validateEntraAdmission({ roles: ["taskdesk.staff"], acct: 0 }, policy),
    ).toEqual({ ok: true });
    expect(
      validateEntraAdmission({ roles: ["other"], acct: 0 }, policy),
    ).toEqual({ ok: false, reason: "missing_app_role" });
    expect(
      validateEntraAdmission({ roles: ["taskdesk.staff"], acct: 1 }, policy),
    ).toEqual({ ok: false, reason: "guest_account" });
    expect(
      validateEntraAdmission({ roles: ["taskdesk.staff"] }, policy),
    ).toEqual({ ok: false, reason: "guest_account" });
  });
});

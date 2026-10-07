import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDENTITY_CLAIM_MAPPING,
  mapIdentityProfile,
  parseIdentityClaimMapping,
} from "./claim-mapping.js";

describe("identity claim mapping", () => {
  it("uses the fixed profile-only default for a missing or null value", () => {
    expect(parseIdentityClaimMapping(undefined)).toEqual({
      ok: true,
      value: DEFAULT_IDENTITY_CLAIM_MAPPING,
    });
    expect(parseIdentityClaimMapping(null)).toEqual({
      ok: true,
      value: DEFAULT_IDENTITY_CLAIM_MAPPING,
    });
  });

  it("accepts only the registered display-name mapping", () => {
    expect(
      parseIdentityClaimMapping({ version: 1, displayName: "name" }),
    ).toEqual({ ok: true, value: DEFAULT_IDENTITY_CLAIM_MAPPING });
  });

  it.each([
    { version: 1, displayName: "email" },
    { version: 2, displayName: "name" },
    { version: 1, displayName: "name", subject: "sub" },
    ["name"],
    "name",
  ])("fails closed on malformed or authority-bearing map %#", (value) => {
    expect(parseIdentityClaimMapping(value).ok).toBe(false);
  });

  it("maps only a valid optional name and never invents one", () => {
    expect(mapIdentityProfile({ name: "  Casey Staff  " }, null)).toEqual({
      ok: true,
      displayName: "Casey Staff",
    });
    expect(
      mapIdentityProfile({ preferred_username: "casey@example.test" }, null),
    ).toEqual({
      ok: true,
    });
    expect(mapIdentityProfile({ name: "\u0001" }, null)).toEqual({ ok: true });
  });

  it("fails profile mapping closed for a malformed persisted value", () => {
    expect(
      mapIdentityProfile(
        { name: "Casey" },
        { version: 1, displayName: "email" },
      ),
    ).toEqual({ ok: false, reason: "invalid_mapping" });
  });
});

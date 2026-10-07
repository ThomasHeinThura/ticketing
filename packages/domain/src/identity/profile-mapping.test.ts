import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCIM_PROFILE_MAPPING,
  mapScimProfile,
  parseScimProfileAttributeMapping,
} from "./profile-mapping.js";

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

function user(overrides: Record<string, unknown> = {}) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    userName: "contact@example.test",
    displayName: "Riley Example",
    emails: [{ value: "riley@example.test", primary: true }],
    title: "Support",
    preferredLanguage: "en",
    ...overrides,
  };
}

describe("IP-17: closed SCIM profile mapping", () => {
  it("accepts only the complete version-one allowlisted map", () => {
    expect(
      parseScimProfileAttributeMapping(DEFAULT_SCIM_PROFILE_MAPPING),
    ).toEqual({
      ok: true,
      value: DEFAULT_SCIM_PROFILE_MAPPING,
    });
    expect(
      parseScimProfileAttributeMapping({
        ...DEFAULT_SCIM_PROFILE_MAPPING,
        name: "name.givenName",
      }),
    ).toEqual({ ok: false, reason: "invalid_resource" });
    expect(
      parseScimProfileAttributeMapping({
        ...DEFAULT_SCIM_PROFILE_MAPPING,
        hidden: "scopeId",
      }),
    ).toEqual({ ok: false, reason: "invalid_resource" });
  });

  it("maps only the selected profile fields and excludes identity/authority input", () => {
    expect(
      mapScimProfile(
        user({ externalId: "provider-key", active: false }),
        DEFAULT_SCIM_PROFILE_MAPPING,
        { complete: true },
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Riley Example",
        email: "riley@example.test",
        jobTitle: "Support",
        locale: "en",
      },
    });
  });

  it("IP-17: chooses one explicit primary or the sole email and refuses ambiguity", () => {
    const mapping = DEFAULT_SCIM_PROFILE_MAPPING;
    expect(
      mapScimProfile(
        user({ emails: [{ value: "riley@example.test" }] }),
        mapping,
        { complete: true },
      ),
    ).toMatchObject({ ok: true, value: { email: "riley@example.test" } });
    expect(
      mapScimProfile(
        user({
          emails: [{ value: "a@example.test" }, { value: "b@example.test" }],
        }),
        mapping,
        { complete: true },
      ),
    ).toEqual({ ok: false, reason: "invalid_resource" });
    expect(
      mapScimProfile(
        user({
          emails: [
            { value: "a@example.test", primary: true },
            { value: "b@example.test", primary: true },
          ],
        }),
        mapping,
        { complete: true },
      ),
    ).toEqual({ ok: false, reason: "invalid_resource" });
  });

  it("IP-17: permits userName as contact metadata without changing the lookup key", () => {
    const mapping = {
      ...DEFAULT_SCIM_PROFILE_MAPPING,
      email: "userName",
    } as const;
    expect(
      mapScimProfile(
        user({ userName: "contact@example.test", emails: [] }),
        mapping,
        { complete: true },
      ),
    ).toMatchObject({
      ok: true,
      value: { email: "contact@example.test" },
    });
  });

  it("IP-17: leaves unmapped optional fields unchanged and requires mapped fields on create", () => {
    const mapping = {
      ...DEFAULT_SCIM_PROFILE_MAPPING,
      jobTitle: "unmapped",
      locale: "unmapped",
    } as const;
    expect(
      mapScimProfile(
        user({ title: "Ignored", preferredLanguage: "fr" }),
        mapping,
        {
          complete: false,
          current: {
            name: "Existing Name",
            email: "existing@example.test",
            jobTitle: "Existing title",
            locale: "de",
          },
        },
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Riley Example",
        email: "riley@example.test",
        jobTitle: "Existing title",
        locale: "de",
      },
    });
    expect(
      mapScimProfile(
        user({ displayName: undefined }),
        DEFAULT_SCIM_PROFILE_MAPPING,
        { complete: true },
      ),
    ).toEqual({ ok: false, reason: "invalid_resource" });
  });
});

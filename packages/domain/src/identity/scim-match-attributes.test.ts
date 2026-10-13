import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCIM_MATCH_ATTRIBUTES,
  effectiveScimMatchAttributes,
  parseScimMatchAttributes,
  parseScimUserFilter,
} from "./scim-match-attributes.js";

describe("IP-13 configured SCIM user match attributes", () => {
  it("uses the narrow v1 default for legacy null configuration", () => {
    expect(effectiveScimMatchAttributes(null)).toEqual({
      ok: true,
      value: DEFAULT_SCIM_MATCH_ATTRIBUTES,
    });
  });

  it("accepts only canonical, supported profile paths after required identifiers", () => {
    expect(
      parseScimMatchAttributes([
        "externalId",
        "userName",
        "displayName",
        "title",
        "preferredLanguage",
      ]),
    ).toEqual({
      ok: true,
      value: [
        "externalId",
        "userName",
        "displayName",
        "title",
        "preferredLanguage",
      ],
    });
  });

  it.each([
    [],
    ["userName", "externalId"],
    ["externalId", "userName", "emails.value"],
    ["externalId", "userName", "locale"],
    ["externalId", "userName", "DISPLAYNAME"],
    ["externalId", "userName", "title", "displayName"],
    ["externalId", "userName", "title", "title"],
    "externalId,userName",
    ["externalId", "userName", null],
  ])("rejects unsupported or noncanonical configuration %#", (value) => {
    expect(parseScimMatchAttributes(value).ok).toBe(false);
  });

  it("fails closed for malformed persisted values instead of applying defaults", () => {
    expect(effectiveScimMatchAttributes(["externalId"])).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
  });

  it("parses one quoted equality filter with SCIM case-insensitive attribute names", () => {
    expect(parseScimUserFilter('DISPLAYNAME eq "A \\"quoted\\" name"')).toEqual(
      {
        ok: true,
        value: { attribute: "displayName", value: 'A "quoted" name' },
      },
    );
    expect(parseScimUserFilter('name.formatted eq "A Person"')).toEqual({
      ok: true,
      value: { attribute: "name.formatted", value: "A Person" },
    });
    expect(parseScimUserFilter(undefined)).toEqual({ ok: true, value: null });
  });

  it.each([
    'emails.value eq "person@example.test"',
    'locale eq "en"',
    'displayName co "A"',
    'displayName eq "A" and title eq "B"',
    'displayName eq "bad\\nvalue"',
    `displayName eq "bad${String.fromCharCode(1)}value"`,
    'notAnAttribute eq "A"',
  ])("rejects malformed, compound, and unsupported filters: %s", (filter) => {
    expect(parseScimUserFilter(filter).ok).toBe(false);
  });
});

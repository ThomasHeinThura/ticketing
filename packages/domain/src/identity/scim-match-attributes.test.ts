import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCIM_MATCH_ATTRIBUTES,
  effectiveScimMatchAttributes,
  parseScimGroupFilter,
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

describe("parseScimGroupFilter", () => {
  it("accepts undefined as null filter", () => {
    expect(parseScimGroupFilter(undefined)).toEqual({ ok: true, value: null });
  });

  it("parses displayName and externalId equality filters with case-insensitive attribute and operator", () => {
    expect(parseScimGroupFilter('displayName eq "Group Two"')).toEqual({
      ok: true,
      value: { attribute: "displayName", value: "Group Two" },
    });
    expect(parseScimGroupFilter('externalId eq "ext-group-2"')).toEqual({
      ok: true,
      value: { attribute: "externalId", value: "ext-group-2" },
    });
    expect(
      parseScimGroupFilter('DISPLAYNAME EQ "Engineering \\"Core\\""'),
    ).toEqual({
      ok: true,
      value: { attribute: "displayName", value: 'Engineering "Core"' },
    });
    expect(parseScimGroupFilter('  EXTERNALID Eq "ext-2"  ')).toEqual({
      ok: true,
      value: { attribute: "externalId", value: "ext-2" },
    });
  });

  it.each([
    'id eq "x"',
    'userName eq "group"',
    'members eq "user-1"',
    'displayName co "Group"',
    'displayName sw "Group"',
    'displayName eq "A" and externalId eq "B"',
    'displayName eq "A" or displayName eq "B"',
    "displayName eq Group",
    'displayName eq "bad\\nvalue"',
    `displayName eq "bad${String.fromCharCode(1)}value"`,
    `externalId eq "bad${String.fromCharCode(0x7f)}value"`,
    "",
  ])("rejects unsupported or malformed group filter: %s", (filter) => {
    expect(parseScimGroupFilter(filter)).toEqual({
      ok: false,
      reason: "invalid_resource",
    });
  });
});

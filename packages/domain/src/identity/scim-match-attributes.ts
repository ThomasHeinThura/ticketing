import type { ScimResult } from "./types.js";

export const DEFAULT_SCIM_MATCH_ATTRIBUTES = [
  "externalId",
  "userName",
] as const;

export const OPTIONAL_SCIM_MATCH_ATTRIBUTES = [
  "displayName",
  "name.formatted",
  "title",
  "preferredLanguage",
] as const;

export type ScimMatchAttribute =
  | (typeof DEFAULT_SCIM_MATCH_ATTRIBUTES)[number]
  | (typeof OPTIONAL_SCIM_MATCH_ATTRIBUTES)[number];

export type ScimMatchAttributes = readonly ScimMatchAttribute[];
export type ScimUserFilter = {
  attribute: ScimMatchAttribute;
  value: string;
};

const allowed = new Set<ScimMatchAttribute>([
  ...DEFAULT_SCIM_MATCH_ATTRIBUTES,
  ...OPTIONAL_SCIM_MATCH_ATTRIBUTES,
]);

export function parseScimMatchAttributes(
  input: unknown,
): ScimResult<ScimMatchAttributes> {
  if (
    !Array.isArray(input) ||
    input.some(
      (value) =>
        typeof value !== "string" || !allowed.has(value as ScimMatchAttribute),
    ) ||
    new Set(input).size !== input.length ||
    input[0] !== "externalId" ||
    input[1] !== "userName"
  ) {
    return { ok: false, reason: "invalid_resource" };
  }

  const optional = input.slice(2) as string[];
  const canonicalOptional = OPTIONAL_SCIM_MATCH_ATTRIBUTES.filter((value) =>
    optional.includes(value),
  );
  if (
    optional.length !== canonicalOptional.length ||
    optional.some((value, index) => value !== canonicalOptional[index])
  ) {
    return { ok: false, reason: "invalid_resource" };
  }

  return {
    ok: true,
    value: [...input] as ScimMatchAttributes,
  };
}

export function effectiveScimMatchAttributes(
  input: unknown,
): ScimResult<ScimMatchAttributes> {
  if (input === null || input === undefined) {
    return { ok: true, value: DEFAULT_SCIM_MATCH_ATTRIBUTES };
  }
  return parseScimMatchAttributes(input);
}

export const SCIM_GROUP_FILTER_ATTRIBUTES = [
  "displayName",
  "externalId",
] as const;

export type ScimGroupFilterAttribute =
  (typeof SCIM_GROUP_FILTER_ATTRIBUTES)[number];

export type ScimGroupFilter = {
  attribute: ScimGroupFilterAttribute;
  value: string;
};

const USER_FILTER_ATTRIBUTES = new Map<string, ScimMatchAttribute>([
  ["externalid", "externalId"],
  ["username", "userName"],
  ["displayname", "displayName"],
  ["name.formatted", "name.formatted"],
  ["title", "title"],
  ["preferredlanguage", "preferredLanguage"],
]);

const GROUP_FILTER_ATTRIBUTES = new Map<string, ScimGroupFilterAttribute>([
  ["displayname", "displayName"],
  ["externalid", "externalId"],
]);

function parseScimEqFilter<T extends string>(
  input: string | undefined,
  attributes: ReadonlyMap<string, T>,
): ScimResult<{ attribute: T; value: string } | null> {
  if (input === undefined) return { ok: true, value: null };
  if (input.length > 512) return { ok: false, reason: "invalid_resource" };
  const match = input.match(
    /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:\\.|[^"\\])*)"\s*$/iu,
  );
  if (!match) return { ok: false, reason: "invalid_resource" };
  const rawAttribute = match[1]?.toLowerCase();
  const rawValue = match[2];
  if (!rawAttribute || rawValue === undefined)
    return { ok: false, reason: "invalid_resource" };
  const attribute = attributes.get(rawAttribute);
  if (!attribute) return { ok: false, reason: "invalid_resource" };
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(`"${rawValue}"`);
  } catch {
    return { ok: false, reason: "invalid_resource" };
  }
  if (typeof parsedValue !== "string")
    return { ok: false, reason: "invalid_resource" };
  for (const character of parsedValue) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || (code >= 0xd800 && code <= 0xdfff))
      return { ok: false, reason: "invalid_resource" };
  }
  return { ok: true, value: { attribute, value: parsedValue } };
}

export function parseScimUserFilter(
  input: string | undefined,
): ScimResult<ScimUserFilter | null> {
  return parseScimEqFilter(input, USER_FILTER_ATTRIBUTES);
}

export function parseScimGroupFilter(
  input: string | undefined,
): ScimResult<ScimGroupFilter | null> {
  return parseScimEqFilter(input, GROUP_FILTER_ATTRIBUTES);
}

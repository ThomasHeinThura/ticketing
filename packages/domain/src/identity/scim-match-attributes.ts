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

export function parseScimUserFilter(
  input: string | undefined,
): ScimResult<ScimUserFilter | null> {
  if (input === undefined) return { ok: true, value: null };
  const match = input.match(
    /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"((?:\\.|[^"\\])*)"\s*$/iu,
  );
  if (!match) return { ok: false, reason: "invalid_resource" };
  const rawAttribute = match[1]?.toLowerCase();
  const rawValue = match[2];
  if (!rawAttribute || rawValue === undefined)
    return { ok: false, reason: "invalid_resource" };
  const attribute = new Map<string, ScimMatchAttribute>([
    ["externalid", "externalId"],
    ["username", "userName"],
    ["displayname", "displayName"],
    ["name.formatted", "name.formatted"],
    ["title", "title"],
    ["preferredlanguage", "preferredLanguage"],
  ]).get(rawAttribute);
  const value = rawValue.replace(/\\(["\\])/gu, "$1");
  if (
    !attribute ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    return { ok: false, reason: "invalid_resource" };
  return { ok: true, value: { attribute, value } };
}

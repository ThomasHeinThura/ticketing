import { parseScimUser } from "./identity.js";
import type {
  ScimPersonAttributes,
  ScimProfile,
  ScimProfileAttributeMapping,
  ScimResult,
} from "./types.js";

export const DEFAULT_SCIM_PROFILE_MAPPING: ScimProfileAttributeMapping = {
  version: 1,
  name: "displayName",
  email: "emails.primary.value",
  jobTitle: "title",
  locale: "preferredLanguage",
};

const mappingFields = [
  "version",
  "name",
  "email",
  "jobTitle",
  "locale",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function parseScimProfileAttributeMapping(
  value: unknown,
): ScimResult<ScimProfileAttributeMapping> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== mappingFields.length ||
    mappingFields.some((key) => !Object.hasOwn(value, key)) ||
    value.version !== 1 ||
    (value.name !== "displayName" && value.name !== "name.formatted") ||
    (value.email !== "emails.primary.value" && value.email !== "userName") ||
    (value.jobTitle !== "title" && value.jobTitle !== "unmapped") ||
    (value.locale !== "preferredLanguage" &&
      value.locale !== "locale" &&
      value.locale !== "unmapped")
  ) {
    return { ok: false, reason: "invalid_resource" };
  }
  return {
    ok: true,
    value: {
      version: 1,
      name: value.name,
      email: value.email,
      jobTitle: value.jobTitle,
      locale: value.locale,
    },
  };
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.hasOwn(value, key);
}

function profileValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : undefined;
}

function profileEmail(value: string | undefined): string | undefined {
  const email = profileValue(value);
  if (!email || email.length > 254) return undefined;
  for (let index = 0; index < email.length; index += 1) {
    const code = email.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return undefined;
  }
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1)
    return undefined;
  return email;
}

export function mapScimProfile(
  raw: unknown,
  mappingInput: unknown,
  options: { complete: boolean; current?: Partial<ScimProfile> },
): ScimResult<ScimProfile> {
  const validatedMapping = parseScimProfileAttributeMapping(mappingInput);
  if (!validatedMapping.ok) return validatedMapping;
  const parsed = parseScimUser(raw);
  if (!parsed.ok) return parsed;
  const attributes: ScimPersonAttributes = parsed.value;
  const mapping = validatedMapping.value;
  const source = isRecord(raw) ? raw : {};
  const nameSupplied =
    mapping.name === "displayName"
      ? hasOwn(source, "displayName")
      : isRecord(source.name) && Object.hasOwn(source.name, "formatted");
  const emailSupplied =
    mapping.email === "userName"
      ? hasOwn(source, "userName")
      : hasOwn(source, "emails");
  const nameRaw =
    mapping.name === "displayName"
      ? attributes.displayName
      : attributes.name?.formatted;
  const emailRaw =
    mapping.email === "userName" ? attributes.userName : attributes.email;
  const name = nameSupplied ? profileValue(nameRaw) : options.current?.name;
  const email = emailSupplied ? profileEmail(emailRaw) : options.current?.email;
  if ((options.complete || nameSupplied) && !name)
    return { ok: false, reason: "invalid_resource" };
  if ((options.complete || emailSupplied) && !email)
    return { ok: false, reason: "invalid_resource" };

  const jobTitleSupplied =
    mapping.jobTitle === "title" && hasOwn(source, "title");
  const localeSource = mapping.locale;
  const localeSupplied =
    localeSource !== "unmapped" && hasOwn(source, localeSource);
  const jobTitle = jobTitleSupplied
    ? profileValue(attributes.title)
    : options.current?.jobTitle;
  const locale = localeSupplied
    ? profileValue(
        localeSource === "preferredLanguage"
          ? attributes.preferredLanguage
          : attributes.locale,
      )
    : options.current?.locale;
  if (jobTitleSupplied && attributes.title !== undefined && !jobTitle)
    return { ok: false, reason: "invalid_resource" };
  if (localeSupplied && !locale)
    return { ok: false, reason: "invalid_resource" };

  return {
    ok: true,
    value: {
      name: name ?? "",
      email: email ?? "",
      ...(jobTitle === undefined ? {} : { jobTitle }),
      ...(locale === undefined ? {} : { locale }),
    },
  };
}

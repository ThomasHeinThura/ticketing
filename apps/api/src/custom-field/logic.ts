/**
 * Custom field rules (feature-contracts-p4.md, "Custom fields"). Everything here is pure so the
 * contract's behaviour can be unit tested without a database: format validation (CF formats),
 * per-type visibility and requiredness (CF-2, CF-3), single-level conditional visibility (CF-6),
 * the required-field gate (CF-4), select option stability (CF-7) and the format lock (CF-9).
 */

export const CUSTOM_FIELD_FORMATS = [
  "text",
  "long_text",
  "number",
  "decimal",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multi_select",
  "user",
  "multi_user",
  "url",
  "email",
] as const;

export type CustomFieldFormat = (typeof CUSTOM_FIELD_FORMATS)[number];

export type CustomFieldOption = { key: string; label: string };

export const VISIBILITY_OPS = ["eq", "neq", "in", "is_set"] as const;
export type VisibilityOp = (typeof VISIBILITY_OPS)[number];

/** CF-6: `{ field_key, op, value }`; strictly single-level. */
export type VisibilityCondition = {
  field_key: string;
  op: VisibilityOp;
  value?: unknown;
};

export type FieldDefinition = {
  id: string;
  key: string;
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  defaultValue: unknown;
  visibilityCondition: VisibilityCondition | null;
};

/** One field's applicability to one work item type (`custom_field_type_visibility`). */
export type TypeVisibility = { visible: boolean; required: boolean };

export const MAX_TEXT_LENGTH = 500;
export const MAX_LONG_TEXT_LENGTH = 20000;
export const MAX_URL_LENGTH = 2000;
export const MAX_SELECT_OPTIONS = 200;
/** The contract allows 100 fields on one type but warns; the API reports this threshold. */
export const FIELD_COUNT_WARNING_THRESHOLD = 100;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const OPTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isValidFieldKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Does `value` count as "filled in"? Empty strings, empty lists and null are empty. */
export function isValueSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export type ValueResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

const fail = (message: string): ValueResult => ({ ok: false, message });

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

/**
 * Validate and normalise one value for a field. `null` (and an empty string) clears the value
 * and is always accepted; requiredness is a separate rule (`missingRequiredFields`).
 */
export function validateFieldValue(
  field: Pick<FieldDefinition, "format" | "options">,
  value: unknown,
): ValueResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "string" && value.trim() === "")
    return { ok: true, value: null };
  // Postgres jsonb rejects a NUL anywhere in a document.
  if (JSON.stringify(value)?.includes("\\u0000"))
    return fail("Contains an invalid character");
  const optionKeys = new Set(field.options.map((option) => option.key));
  switch (field.format) {
    case "text":
      if (typeof value !== "string") return fail("Expected text");
      if (value.length > MAX_TEXT_LENGTH)
        return fail(`Text is limited to ${MAX_TEXT_LENGTH} characters`);
      return { ok: true, value: value.trim() };
    case "long_text":
      if (typeof value !== "string") return fail("Expected text");
      if (value.length > MAX_LONG_TEXT_LENGTH)
        return fail(`Text is limited to ${MAX_LONG_TEXT_LENGTH} characters`);
      return { ok: true, value };
    case "number":
      if (typeof value !== "number" || !Number.isSafeInteger(value))
        return fail("Expected a whole number");
      return { ok: true, value };
    case "decimal":
      if (typeof value !== "number" || !Number.isFinite(value))
        return fail("Expected a number");
      return { ok: true, value };
    case "currency": {
      if (typeof value !== "object" || Array.isArray(value))
        return fail("Expected { amount, currency }");
      const { amount, currency } = value as Record<string, unknown>;
      if (typeof amount !== "number" || !Number.isFinite(amount))
        return fail("Currency amount must be a number");
      if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency))
        return fail("Currency code must be three capital letters");
      return { ok: true, value: { amount, currency } };
    }
    case "date":
      if (typeof value !== "string" || !validDate(value))
        return fail("Expected a date as YYYY-MM-DD");
      return { ok: true, value };
    case "datetime": {
      if (typeof value !== "string") return fail("Expected a date and time");
      if (!/(Z|[+-]\d{2}:\d{2})$/.test(value))
        return fail("Date and time must include a timezone offset");
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()))
        return fail("Expected a valid date and time");
      return { ok: true, value: parsed.toISOString() };
    }
    case "boolean":
      if (typeof value !== "boolean") return fail("Expected true or false");
      return { ok: true, value };
    case "select":
      if (typeof value !== "string" || !optionKeys.has(value))
        return fail("Unknown option");
      return { ok: true, value };
    case "multi_select": {
      if (!Array.isArray(value)) return fail("Expected a list of options");
      const keys = [...new Set(value)];
      if (keys.some((key) => typeof key !== "string" || !optionKeys.has(key)))
        return fail("Unknown option");
      return { ok: true, value: keys };
    }
    case "user":
      if (typeof value !== "string") return fail("Expected a person");
      return { ok: true, value };
    case "multi_user": {
      if (!Array.isArray(value)) return fail("Expected a list of people");
      if (value.some((entry) => typeof entry !== "string"))
        return fail("Expected a list of people");
      return { ok: true, value: [...new Set(value as string[])] };
    }
    case "url": {
      if (typeof value !== "string" || value.length > MAX_URL_LENGTH)
        return fail("Expected a URL");
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          return fail("Only http and https links are allowed");
      } catch {
        return fail("Expected a valid URL");
      }
      return { ok: true, value };
    }
    case "email":
      if (
        typeof value !== "string" ||
        value.length > 320 ||
        !EMAIL_PATTERN.test(value)
      )
        return fail("Expected an email address");
      return { ok: true, value };
    default:
      return fail("Unsupported format");
  }
}

/** Validate a select's option list: stable keys, editable labels (CF-7). */
export function validateOptions(
  format: CustomFieldFormat,
  options: readonly CustomFieldOption[],
): string | null {
  const needsOptions = format === "select" || format === "multi_select";
  if (!needsOptions) {
    return options.length > 0 ? "Only select fields take options" : null;
  }
  if (options.length === 0) return "A select field needs at least one option";
  if (options.length > MAX_SELECT_OPTIONS)
    return `A select field is limited to ${MAX_SELECT_OPTIONS} options`;
  const seen = new Set<string>();
  for (const option of options) {
    if (!OPTION_KEY_PATTERN.test(option.key))
      return `Option key "${option.key}" must be lowercase letters, digits, - or _`;
    if (option.label.trim().length === 0) return "Every option needs a label";
    if (seen.has(option.key)) return `Duplicate option key "${option.key}"`;
    seen.add(option.key);
  }
  return null;
}

/** Option keys present before and absent after: removing one that is in use is refused (CF-7). */
export function removedOptionKeys(
  before: readonly CustomFieldOption[],
  after: readonly CustomFieldOption[],
): string[] {
  const kept = new Set(after.map((option) => option.key));
  return before.map((option) => option.key).filter((key) => !kept.has(key));
}

/** CF-9: the format of an existing field never changes. */
export function formatChangeRefused(
  current: CustomFieldFormat,
  requested: CustomFieldFormat | undefined,
): boolean {
  return requested !== undefined && requested !== current;
}

/** Shape check for a stored/submitted visibility condition. */
export function parseVisibilityCondition(
  raw: unknown,
): VisibilityCondition | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { field_key, op, value } = raw as Record<string, unknown>;
  if (typeof field_key !== "string" || !isValidFieldKey(field_key))
    return "invalid";
  if (!VISIBILITY_OPS.includes(op as VisibilityOp)) return "invalid";
  if (op === "in" && !Array.isArray(value)) return "invalid";
  if (op === "is_set") return { field_key, op: "is_set" };
  if (value === undefined) return "invalid";
  return { field_key, op: op as VisibilityOp, value };
}

/**
 * CF-6: may `field` carry `condition`? The controlling field must exist, must not be the field
 * itself, and must not itself be conditional (single level). Making a field conditional is also
 * refused while another field already uses it as a controller.
 */
export function conditionRefusal(
  field: { key: string },
  condition: VisibilityCondition,
  others: readonly Pick<FieldDefinition, "key" | "visibilityCondition">[],
): string | null {
  if (condition.field_key === field.key)
    return "A field cannot depend on itself";
  const controller = others.find((other) => other.key === condition.field_key);
  if (!controller) return `Unknown controlling field "${condition.field_key}"`;
  if (controller.visibilityCondition !== null)
    return "A controlling field may not itself be conditional";
  const dependents = others.filter(
    (other) => other.visibilityCondition?.field_key === field.key,
  );
  if (dependents.length > 0)
    return `Other fields depend on "${field.key}": ${dependents.map((d) => d.key).join(", ")}`;
  return null;
}

/** Fields whose condition references `key`, for the delete refusal edge case. */
export function fieldsConditionedOn(
  key: string,
  fields: readonly Pick<FieldDefinition, "key" | "visibilityCondition">[],
): string[] {
  return fields
    .filter((field) => field.visibilityCondition?.field_key === key)
    .map((field) => field.key);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** CF-6 evaluation against the work item's current values, keyed by field key. */
export function conditionSatisfied(
  condition: VisibilityCondition | null,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (condition === null) return true;
  const actual = values[condition.field_key];
  switch (condition.op) {
    case "is_set":
      return isValueSet(actual);
    case "eq":
      return sameValue(actual, condition.value);
    case "neq":
      return !sameValue(actual, condition.value);
    case "in": {
      const allowed = Array.isArray(condition.value) ? condition.value : [];
      if (Array.isArray(actual))
        return actual.some((entry) =>
          allowed.some((candidate) => sameValue(candidate, entry)),
        );
      return allowed.some((candidate) => sameValue(candidate, actual));
    }
    default:
      return false;
  }
}

export type ApplicableField<T extends FieldDefinition = FieldDefinition> = T & {
  required: boolean;
  /** False when a conditional field's condition is currently unmet (CF-6). */
  shown: boolean;
};

/**
 * CF-2/CF-3: the fields that exist on the form for one work item type. A field with no
 * visibility row, or `visible: false`, is absent (not disabled). `shown` reflects CF-6.
 */
export function applicableFields<T extends FieldDefinition>(
  fields: readonly T[],
  visibilityByFieldId: ReadonlyMap<string, TypeVisibility>,
  values: Readonly<Record<string, unknown>>,
): ApplicableField<T>[] {
  const result: ApplicableField<T>[] = [];
  for (const field of fields) {
    const visibility = visibilityByFieldId.get(field.id);
    if (!visibility?.visible) continue;
    result.push({
      ...field,
      required: visibility.required,
      shown: conditionSatisfied(field.visibilityCondition, values),
    });
  }
  return result;
}

/**
 * CF-4: keys of required, currently-shown fields that are empty. A field hidden by an unmet
 * condition is not required (CF-6); evaluated server-side by callers.
 */
export function missingRequiredFields(
  fields: readonly FieldDefinition[],
  visibilityByFieldId: ReadonlyMap<string, TypeVisibility>,
  values: Readonly<Record<string, unknown>>,
): string[] {
  return applicableFields(fields, visibilityByFieldId, values)
    .filter((field) => field.required && field.shown)
    .filter((field) => !isValueSet(values[field.key]))
    .map((field) => field.key);
}

/** CF-4: the `cancelled` group is deliberately exempt; only started/completed are gated. */
export function transitionRequiresFields(targetGroup: string): boolean {
  return targetGroup === "started" || targetGroup === "completed";
}

/**
 * The value a new work item starts with (CF-5): its field default when valid, else nothing.
 * An invalid stored default is ignored rather than failing creation.
 */
export function defaultValueFor(field: FieldDefinition): unknown {
  if (field.defaultValue === null || field.defaultValue === undefined)
    return null;
  const result = validateFieldValue(field, field.defaultValue);
  return result.ok ? result.value : null;
}

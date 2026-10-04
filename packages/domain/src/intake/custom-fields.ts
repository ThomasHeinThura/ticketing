import type { VisibilityCondition } from "./types.js";

export type CustomFieldFormat =
  | "text"
  | "long_text"
  | "number"
  | "decimal"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multi_select"
  | "user"
  | "multi_user"
  | "url"
  | "email";

export interface CustomFieldDefinition {
  readonly key: string;
  readonly format: CustomFieldFormat;
  readonly options: unknown;
  readonly defaultValue: unknown;
  readonly condition: VisibilityCondition | null;
  readonly visible: boolean;
  readonly required: boolean;
}

export interface CustomFieldValidationContext {
  readonly personIds?: ReadonlySet<string>;
  readonly emailIsValid?: (value: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasNoNul(value: string): boolean {
  return !value.includes("\u0000");
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days =
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ??
    0;
  return day >= 1 && day <= days;
}

function validDateTime(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !validCalendarDate(match[1] ?? "")) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const offset = match[6];
  if (offset !== "Z") {
    const offsetHours = Number(offset?.slice(1, 3));
    const offsetMinutes = Number(offset?.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function optionsKeys(options: unknown): ReadonlySet<string> {
  if (!Array.isArray(options)) return new Set();
  return new Set(
    options.flatMap((option) =>
      isRecord(option) &&
      option.active !== false &&
      typeof option.key === "string"
        ? [option.key]
        : [],
    ),
  );
}

function supportedCurrency(value: string): boolean {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "currency") => string[];
  };
  return (
    value === value.toUpperCase() &&
    /^[A-Z]{3}$/.test(value) &&
    (intl.supportedValuesOf?.("currency") ?? []).includes(value)
  );
}

function validDecimal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{0,5}[1-9])?$/.test(value)) return false;
  if (value === "-0") return false;
  const digits = value.replace(/[-.]/g, "");
  return digits.length <= 18;
}

export function isValidCustomFieldValue(
  format: CustomFieldFormat,
  value: unknown,
  options: unknown,
  context: CustomFieldValidationContext = {},
): boolean {
  if (value === null) return true;
  switch (format) {
    case "text":
      return (
        typeof value === "string" && value.length <= 500 && hasNoNul(value)
      );
    case "long_text":
      return (
        typeof value === "string" && value.length <= 20_000 && hasNoNul(value)
      );
    case "number":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "decimal":
      return validDecimal(value);
    case "currency":
      return (
        isRecord(value) &&
        Object.keys(value).length === 2 &&
        validDecimal(value.amount) &&
        typeof value.currency === "string" &&
        supportedCurrency(value.currency)
      );
    case "date":
      return typeof value === "string" && validCalendarDate(value);
    case "datetime":
      return typeof value === "string" && validDateTime(value);
    case "boolean":
      return typeof value === "boolean";
    case "select":
      return typeof value === "string" && optionsKeys(options).has(value);
    case "multi_select":
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string") &&
        new Set(value).size === value.length &&
        value.every((entry) => optionsKeys(options).has(entry as string))
      );
    case "user":
      return (
        typeof value === "string" && (context.personIds?.has(value) ?? false)
      );
    case "multi_user":
      return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string") &&
        new Set(value).size === value.length &&
        value.every((entry) => context.personIds?.has(entry as string) ?? false)
      );
    case "url": {
      if (typeof value !== "string" || value.length > 2_048 || !hasNoNul(value))
        return false;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }
    case "email":
      return (
        typeof value === "string" && (context.emailIsValid?.(value) ?? false)
      );
  }
}

export function normalizeCustomFieldValue(
  format: CustomFieldFormat,
  value: unknown,
): unknown {
  if (format === "datetime" && typeof value === "string") {
    return new Date(value).toISOString();
  }
  return value;
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, i) => equalJson(value, right[i]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, i) => key === rightKeys[i] && equalJson(left[key], right[key]),
      )
    );
  }
  return false;
}

function isSet(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    !(typeof value === "string" && value.trim() === "")
  );
}

function conditionMatches(
  condition: VisibilityCondition | null,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (!condition) return true;
  if (
    typeof condition.field_key !== "string" ||
    !["eq", "neq", "in", "is_set"].includes(condition.op) ||
    (condition.op === "in" && !Array.isArray(condition.value))
  )
    return true;
  const actual = values[condition.field_key] ?? null;
  const expected = condition.value ?? null;
  switch (condition.op) {
    case "eq":
      return equalJson(actual, expected);
    case "neq":
      return !equalJson(actual, expected);
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.some((item) => equalJson(actual, item))
      );
    case "is_set":
      return isSet(actual);
  }
}

function validCondition(condition: VisibilityCondition): boolean {
  if (!isRecord(condition)) return false;
  const keys = Object.keys(condition).sort();
  if (
    keys.some((key) => key !== "field_key" && key !== "op" && key !== "value")
  )
    return false;
  if (
    typeof condition.field_key !== "string" ||
    condition.field_key.length === 0
  )
    return false;
  if (!["eq", "neq", "in", "is_set"].includes(condition.op)) return false;
  if (condition.op === "in" && !Array.isArray(condition.value)) return false;
  return true;
}

export type CustomFieldResolution =
  | { readonly ok: true; readonly values: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly invalidKeys: readonly string[] };

/** Resolve current visible fields once, applying validated defaults only to omitted values. */
export function resolveCustomFieldValues(
  definitions: readonly CustomFieldDefinition[],
  provided: Readonly<Record<string, unknown>>,
  context: CustomFieldValidationContext = {},
): CustomFieldResolution {
  const fields = definitions.filter((field) => field.visible);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const values: Record<string, unknown> = {};
  const invalid = new Set<string>();
  const ordered = [
    ...fields.filter((field) => !field.condition),
    ...fields.filter((field) => field.condition),
  ];

  for (const field of ordered) {
    const conditionIsValid =
      field.condition === null || validCondition(field.condition);
    const controller =
      field.condition && conditionIsValid
        ? byKey.get(field.condition.field_key)
        : undefined;
    if (
      field.condition &&
      (!conditionIsValid || !controller || controller.condition)
    ) {
      invalid.add(field.key);
      continue;
    }
    if (!conditionMatches(field.condition, values)) continue;

    const supplied = Object.hasOwn(provided, field.key);
    const value = supplied ? provided[field.key] : field.defaultValue;
    if (value === undefined || value === null) {
      if (field.required) invalid.add(field.key);
      continue;
    }
    if (!isValidCustomFieldValue(field.format, value, field.options, context)) {
      invalid.add(field.key);
      continue;
    }
    values[field.key] = value;
  }

  return invalid.size
    ? { ok: false, invalidKeys: [...invalid] }
    : { ok: true, values };
}

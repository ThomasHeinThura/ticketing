/**
 * Custom field rules the interface needs client-side (CF-3, CF-6): which fields apply to a type,
 * whether a conditional field is currently shown, and which required fields are still empty. The
 * API evaluates the same rules authoritatively (`apps/api/src/custom-field/logic.ts`); this copy
 * only decides what the form offers.
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
export type VisibilityOp = "eq" | "neq" | "in" | "is_set";
export type VisibilityCondition = {
  field_key: string;
  op: VisibilityOp;
  value?: unknown;
};

export function isValueSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function conditionSatisfied(
  condition: VisibilityCondition | null | undefined,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (!condition) return true;
  const actual = values[condition.field_key];
  switch (condition.op) {
    case "is_set":
      return isValueSet(actual);
    case "eq":
      return same(actual, condition.value);
    case "neq":
      return !same(actual, condition.value);
    case "in": {
      const allowed = Array.isArray(condition.value) ? condition.value : [];
      return Array.isArray(actual)
        ? actual.some((entry) => allowed.some((c) => same(c, entry)))
        : allowed.some((candidate) => same(candidate, actual));
    }
    default:
      return false;
  }
}

type FieldWithVisibility = {
  id: string;
  key: string;
  position: number;
  sectionId: string;
  visibilityCondition: VisibilityCondition | null;
  visibility: { workItemTypeId: string; visible: boolean; required: boolean }[];
};

/** CF-2/CF-3: fields that exist on the form for `typeId`, with whether each is required. */
export function fieldsForType<T extends FieldWithVisibility>(
  fields: readonly T[],
  typeId: string,
): (T & { required: boolean })[] {
  return fields.flatMap((field) => {
    const row = field.visibility.find(
      (entry) => entry.workItemTypeId === typeId,
    );
    return row?.visible ? [{ ...field, required: row.required }] : [];
  });
}

/** Keys of required, currently shown, empty fields (CF-4, CF-6). */
export function missingRequired<
  T extends {
    key: string;
    required: boolean;
    visibilityCondition: VisibilityCondition | null;
  },
>(fields: readonly T[], values: Readonly<Record<string, unknown>>): string[] {
  return fields
    .filter(
      (field) =>
        field.required &&
        conditionSatisfied(field.visibilityCondition, values) &&
        !isValueSet(values[field.key]),
    )
    .map((field) => field.key);
}

/** A readable one-line rendering of a stored value, for the properties panel. */
export function formatValue(
  field: { format: CustomFieldFormat; options: CustomFieldOption[] },
  value: unknown,
  people: ReadonlyMap<string, string> = new Map(),
): string {
  if (!isValueSet(value)) return "";
  const optionLabel = (key: unknown) =>
    field.options.find((option) => option.key === key)?.label ?? String(key);
  switch (field.format) {
    case "select":
      return optionLabel(value);
    case "multi_select":
      return Array.isArray(value) ? value.map(optionLabel).join(", ") : "";
    case "user":
      return people.get(String(value)) ?? "";
    case "multi_user":
      return Array.isArray(value)
        ? value
            .map((id) => people.get(String(id)) ?? "")
            .filter(Boolean)
            .join(", ")
        : "";
    case "currency": {
      const { amount, currency } = (value ?? {}) as {
        amount?: number;
        currency?: string;
      };
      return typeof amount === "number" && currency
        ? `${amount.toLocaleString()} ${currency}`
        : "";
    }
    case "boolean":
      return value === true ? "Yes" : "No";
    case "date":
      return String(value);
    case "datetime":
      return new Date(String(value)).toLocaleString();
    default:
      return String(value);
  }
}

/** `Asset tag` -> `asset_tag`: the suggested stable key for a new field. */
export function slugifyFieldKey(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(slug) ? slug : slug ? `f_${slug}`.slice(0, 64) : "";
}

export type OptionDraft = { key: string | null; label: string };

/**
 * Gives every option without a key one derived from its label (`Very high` -> `very-high`),
 * unique among the options. Existing keys are never changed: a key is the stable identity a
 * stored value points at (CF-7), only the label is editable.
 */
export function assignOptionKeys(
  options: readonly OptionDraft[],
): CustomFieldOption[] {
  const taken = new Set(
    options.flatMap((option) => (option.key ? [option.key] : [])),
  );
  return options.map((option) => {
    if (option.key) return { key: option.key, label: option.label };
    const base =
      option.label
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 56) || "option";
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
    taken.add(key);
    return { key, label: option.label };
  });
}

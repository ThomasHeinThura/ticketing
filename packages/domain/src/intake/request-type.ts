/**
 * Intake — request-type form schema rules and catalogue visibility.
 *
 * The one implementation of `request-types-and-catalogue.md`'s RT-3/4/5 (mapping,
 * translation, conditional visibility), RT-7/8 (catalogue visibility), and the three
 * unit areas its Testing section demands: "form schema validation; conditional
 * visibility evaluation; mapsTo translation". Pure: no I/O, no custom-field lookup —
 * existence checks the spec puts on *publish* ("mapsTo a custom field that is later
 * deleted → publish validation rejects it") are caller-supplied sets, because only the
 * caller knows which fields exist.
 */

import type {
  FormField,
  FormSchema,
  FormValue,
  OrganisationRequestTypeRow,
  RequestTypeCatalogueEntry,
  VisibilityCondition,
} from "./types.js";

/** A publish-time schema defect, keyed to the field it concerns. */
export type SchemaDefect = {
  readonly key: string | null;
  readonly problem:
    | "empty_key"
    | "duplicate_key"
    | "empty_label"
    | "select_without_options"
    | "show_if_missing_field"
    | "show_if_self_reference"
    | "show_if_invalid_condition"
    | "maps_to_empty"
    | "maps_to_missing_native_field";
};

const VISIBILITY_OPS = new Set(["eq", "neq", "in", "is_set"]);

/** Whether a `showIf` condition is well-formed: known op, `field_key` set, `in`'s value an array. */
function isConditionWellFormed(condition: VisibilityCondition): boolean {
  if (
    typeof condition.field_key !== "string" ||
    condition.field_key.trim() === ""
  ) {
    return false;
  }
  if (!VISIBILITY_OPS.has(condition.op)) return false;
  if (condition.op === "in") return Array.isArray(condition.value);
  return true;
}

/**
 * Publish-time validation of a form schema (RT-5's own edge case: "conditional field
 * whose controlling field is removed → validation at publish rejects it"; plus the
 * structural defects that would make a form unusable). `nativeFields` is the caller's
 * set of mappable native field names — this module never guesses what exists.
 */
export function validateFormSchema(
  schema: FormSchema,
  nativeFields: ReadonlySet<string> = new Set(),
): readonly SchemaDefect[] {
  const defects: SchemaDefect[] = [];
  const seen = new Set<string>();
  const keys = new Set(schema.fields.map((f) => f.key));

  for (const field of schema.fields) {
    const key = field.key.trim() === "" ? null : field.key;
    if (key === null) {
      defects.push({ key: null, problem: "empty_key" });
    } else if (seen.has(key)) {
      defects.push({ key, problem: "duplicate_key" });
    } else {
      seen.add(key);
    }

    if (field.label.trim() === "") {
      defects.push({ key, problem: "empty_label" });
    }
    if (
      (field.type === "select" || field.type === "combobox") &&
      (field.options === undefined || field.options.length === 0)
    ) {
      defects.push({ key, problem: "select_without_options" });
    }
    if (field.showIf !== undefined) {
      if (!isConditionWellFormed(field.showIf)) {
        defects.push({ key, problem: "show_if_invalid_condition" });
      } else if (field.showIf.field_key === field.key) {
        defects.push({ key, problem: "show_if_self_reference" });
      } else if (!keys.has(field.showIf.field_key)) {
        // The spec's own publish-reject case: the controlling field is gone.
        defects.push({ key, problem: "show_if_missing_field" });
      }
    }
    if (field.mapsTo !== undefined) {
      if (field.mapsTo.field.trim() === "") {
        defects.push({ key, problem: "maps_to_empty" });
      } else if (
        nativeFields.size > 0 &&
        field.type !== "file" &&
        !nativeFields.has(field.mapsTo.field)
      ) {
        // The spec's `mapsTo` custom-field-deleted case, generalized: when the caller
        // declares the native set, an unknown target is a publish defect.
        defects.push({ key, problem: "maps_to_missing_native_field" });
      }
    }
  }
  return defects;
}

/**
 * RT-5 conditional visibility: does this field show for the data submitted so far?
 * A field with no `showIf` always shows. `showIf` is the exact `custom_field.
 * visibility_condition` shape (`{ field_key, op, value }`) with all four operators
 * (`eq`/`neq`/`in`/`is_set`). A malformed condition — one `validateFormSchema` should
 * already have rejected at publish, but stored/migrated/seeded data can still carry —
 * fails **closed**: the field counts as visible, so its `required` is still enforced
 * rather than silently skipped (H1).
 */
export function isFieldVisible(
  field: FormField,
  data: Readonly<Record<string, FormValue>>,
): boolean {
  if (field.showIf === undefined) return true;
  const condition = field.showIf;
  if (!isConditionWellFormed(condition)) return true;

  const actual: FormValue = Object.hasOwn(data, condition.field_key)
    ? (data[condition.field_key] ?? null)
    : null;
  const wanted: FormValue = condition.value ?? null;
  switch (condition.op) {
    case "eq":
      return valuesEqual(actual, wanted);
    case "neq":
      return !valuesEqual(actual, wanted);
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.some((v) => valuesEqual(actual, v))
      );
    case "is_set":
      return (
        actual !== null &&
        actual !== undefined &&
        !(typeof actual === "string" && actual.trim() === "")
      );
  }
}

function valuesEqual(a: FormValue, b: FormValue): boolean {
  if (a === b) return true;
  // Arrays compare structurally for visibility purposes.
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((v, i) => valuesEqual(v, b[i] as FormValue))
    );
  }
  return false;
}

/** The fields a customer actually sees for the data so far — required checks apply only here. */
export function visibleFields(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): readonly FormField[] {
  return schema.fields.filter((f) => isFieldVisible(f, data));
}

/** A validation failure against submitted data. */
export type SubmissionDataError = {
  readonly key: string;
  readonly problem: "required_missing" | "not_an_option" | "wrong_type";
};

/**
 * Text/textarea/date answers longer than this are rejected (M2). The spec gives no
 * character limit for `form_data` text answers, so this is a documented implementation
 * default, not a spec contract.
 */
export const MAX_TEXT_ANSWER_LENGTH = 10_000;

/** Whether `value` is a legal answer shape for `field.type` (M2), ignoring `multiple`. */
function isValueOfFieldType(
  type: FormField["type"],
  value: FormValue,
): boolean {
  switch (type) {
    case "checkbox":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "text":
    case "textarea":
    case "date":
      return (
        typeof value === "string" && value.length <= MAX_TEXT_ANSWER_LENGTH
      );
    case "select":
    case "combobox":
      return typeof value === "string";
    case "file":
      // Attachments transfer via the `attachment` table (IQ-9), never as a `form_data`
      // value — this module has no contract for what a file answer's shape would be.
      return true;
  }
}

/** Whether `value` is a legal answer for `field` (M2), honouring `multiple`. */
function isValidAnswer(field: FormField, value: FormValue): boolean {
  if (field.multiple === true) {
    return (
      Array.isArray(value) &&
      value.every((v) => isValueOfFieldType(field.type, v))
    );
  }
  return isValueOfFieldType(field.type, value);
}

/**
 * Submit-time validation (RT-5's point: a hidden field is not required — only the
 * fields *visible for this data* are checked). Unknown keys are NOT rejected: RT-3
 * stores unmapped values in `form_data`, so leniency is the spec's shape, not an
 * oversight. Every visible answer is checked against its field `type` (M2) before
 * `options` membership, so a wrongly typed value (e.g. the string `"true"` for a
 * checkbox) is rejected rather than silently accepted and misread downstream.
 */
export function validateSubmissionData(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): readonly SubmissionDataError[] {
  const errors: SubmissionDataError[] = [];
  for (const field of visibleFields(schema, data)) {
    // Own-property lookup (M1/L4): an inherited key like `toString` must not count as
    // an answer just because `data["toString"]` resolves via the prototype chain.
    const value = Object.hasOwn(data, field.key) ? data[field.key] : undefined;
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (field.required === true && missing) {
      errors.push({ key: field.key, problem: "required_missing" });
      continue;
    }
    if (missing) continue;
    if (!isValidAnswer(field, value)) {
      errors.push({ key: field.key, problem: "wrong_type" });
      continue;
    }
    if (field.options !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      if (
        !values.every(
          (v) => typeof v === "string" && field.options?.includes(v),
        )
      ) {
        errors.push({ key: field.key, problem: "not_an_option" });
      }
    }
  }
  return errors;
}

/**
 * RT-3/RT-4 mapping: translate submitted form data into native work item fields,
 * honouring each `mapsTo`'s optional value translation (the impact→priority example,
 * spec verbatim). Only fields that are visible AND have a `mapsTo` appear; unmapped
 * values stay in `form_data` for the description rendering (IQ-8) — this function never
 * drops data, it only returns the native patch.
 */
export function translateMapsTo(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): Record<string, FormValue> {
  // A `Map` accumulator (M1): a customer answering "constructor" or "__proto__" must
  // never resolve to an inherited `Object.prototype` member, and `mapsTo.field` being
  // `"__proto__"` must never re-target the returned object's own prototype.
  const native = new Map<string, FormValue>();
  for (const field of visibleFields(schema, data)) {
    const mapping = field.mapsTo;
    if (mapping === undefined) continue;
    // Own-property lookup (M1): an inherited key like `toString` must not count as an
    // answer just because `data["toString"]` resolves via the prototype chain.
    const raw = Object.hasOwn(data, field.key) ? data[field.key] : undefined;
    if (raw === undefined || raw === null) continue;
    if (mapping.map !== undefined && typeof raw === "string") {
      // Own-property lookup (M1): `mapping.map[raw]` must never read an inherited
      // `Object.prototype` member (`constructor`, `__proto__`, `toString`, …).
      const translated = Object.hasOwn(mapping.map, raw)
        ? mapping.map[raw]
        : undefined;
      // An unmapped option keeps the raw value: dropping it silently would lose the
      // customer's answer at exactly the moment the schema drifted.
      native.set(mapping.field, translated ?? raw);
    } else {
      native.set(mapping.field, raw);
    }
  }
  return Object.fromEntries(native);
}

/**
 * RT-7/RT-8 catalogue visibility — the data model's own rule, verbatim:
 * "No row ⇒ not visible and not submittable". A crafted request naming a type with no
 * `organisation_request_type` row for this organisation must fail here, at the rule,
 * before any handler considers it (the spec's own integration-test demand).
 */
export function isRequestTypeVisible(
  type: RequestTypeCatalogueEntry,
  organisationId: string,
  rows: readonly OrganisationRequestTypeRow[],
): boolean {
  return (
    type.customerVisible &&
    rows.some(
      (row) =>
        row.organisationId === organisationId &&
        row.requestTypeKey === type.key,
    )
  );
}

/** The customer's catalogue: visible types, grouped and manually ordered (RT-9). */
export function catalogueFor(
  organisationId: string,
  types: readonly RequestTypeCatalogueEntry[],
  rows: readonly OrganisationRequestTypeRow[],
): readonly RequestTypeCatalogueEntry[] {
  return types
    .filter((t) => isRequestTypeVisible(t, organisationId, rows))
    .slice()
    .sort((a, b) => {
      const byGroup = a.group.localeCompare(b.group);
      return byGroup !== 0 ? byGroup : a.position - b.position;
    });
}

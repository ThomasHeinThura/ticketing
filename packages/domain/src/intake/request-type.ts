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
    | "show_if_chained_condition"
    | "maps_to_empty"
    | "maps_to_missing_native_field"
    | "maps_to_invalid_priority_value";
};

const VISIBILITY_OPS = new Set(["eq", "neq", "in", "is_set"]);

/** Canonical RT-5 operator evaluation shared by domain and portal surfaces. */
export function isVisibilityConditionSatisfied(
  condition: VisibilityCondition,
  actual: FormValue,
): boolean {
  const wanted = condition.value ?? null;
  switch (condition.op) {
    case "eq":
      return valuesEqual(actual, wanted);
    case "neq":
      return !valuesEqual(actual, wanted);
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.some((value) => valuesEqual(actual, value))
      );
    case "is_set":
      return (
        actual !== null &&
        actual !== undefined &&
        !(typeof actual === "string" && actual.trim() === "")
      );
    default:
      return false;
  }
}

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
    if (field.showIf !== undefined && field.showIf !== null) {
      const condition = field.showIf;
      if (!isConditionWellFormed(condition)) {
        defects.push({ key, problem: "show_if_invalid_condition" });
      } else if (condition.field_key === field.key) {
        defects.push({ key, problem: "show_if_self_reference" });
      } else if (!keys.has(condition.field_key)) {
        // The spec's own publish-reject case: the controlling field is gone.
        defects.push({ key, problem: "show_if_missing_field" });
      } else {
        // N1: `visibility_condition` is data-model's own "single-level" shape —
        // a field whose controller itself has a `showIf` is a chain, which lets
        // a hidden controller's smuggled answer hide (via `neq`/`in`) or show
        // (via `eq`) a field it should never reach. Reject the chain at publish
        // rather than trying to make every operator safe for it.
        const controller = schema.fields.find(
          (f) => f.key === condition.field_key,
        );
        if (
          controller !== undefined &&
          controller.showIf !== undefined &&
          controller.showIf !== null
        ) {
          defects.push({ key, problem: "show_if_chained_condition" });
        }
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
      if (field.mapsTo.field === "priority") {
        const allowed = new Set(["low", "medium", "high", "urgent"]);
        const invalidPriorityMapping =
          (field.type !== "select" && field.type !== "combobox") ||
          !field.options?.length ||
          (field.options ?? []).some((option) => {
            const mapped =
              field.mapsTo?.map && Object.hasOwn(field.mapsTo.map, option)
                ? field.mapsTo.map[option]
                : option;
            return !allowed.has(mapped ?? "");
          });
        if (invalidPriorityMapping)
          defects.push({ key, problem: "maps_to_invalid_priority_value" });
      }
    }
  }
  return defects;
}

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/u;

/** A number that kept every digit: finite, and an integer only within the safe range. */
function isUsableNumber(value: number): boolean {
  return (
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  );
}

/**
 * A string answer or condition value read as a number, only when it is plain decimal digits
 * (`"50"`, `"-3"`, `"0.5"`). `Number()` alone also accepts `" "`, `"0x10"`, `"1e3"` and
 * `"Infinity"`, and an integer beyond `Number.MAX_SAFE_INTEGER` silently loses digits, so
 * those stay strings and fail as a wrong-typed answer instead.
 */
function parseNumericString(value: string): number | null {
  if (!NUMERIC_STRING.test(value)) return null;
  const num = Number(value);
  return isUsableNumber(num) ? num : null;
}

/**
 * A number answer as the form sends it: a real number, or plain decimal text; `null` for
 * anything the server would refuse. The portal form uses this to convert what the customer
 * typed and to flag a bad entry, so the browser and the server read a number the same way.
 */
export function parseNumberAnswer(value: unknown): number | null {
  if (typeof value === "number") return isUsableNumber(value) ? value : null;
  if (typeof value === "string") return parseNumericString(value);
  return null;
}

function valuesEqual(a: FormValue, b: FormValue): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string") {
    if (a.trim() === "" && b.trim() === "") return true;
  }
  if (typeof a === "boolean" && typeof b === "string") {
    const trimmed = b.trim().toLowerCase();
    if (trimmed === "true") return a === true;
    if (trimmed === "false") return a === false;
  }
  if (typeof a === "string" && typeof b === "boolean") {
    const trimmed = a.trim().toLowerCase();
    if (trimmed === "true") return b === true;
    if (trimmed === "false") return b === false;
  }
  if (typeof a === "number" && typeof b === "string") {
    const num = parseNumericString(b);
    if (num !== null) return a === num;
  }
  if (typeof a === "string" && typeof b === "number") {
    const num = parseNumericString(a);
    if (num !== null) return num === b;
  }
  // Arrays compare structurally for visibility purposes.
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((v, i) => valuesEqual(v, b[i] as FormValue))
    );
  }
  return false;
}

/**
 * Normalise draft answers, coercing legacy numeric string values to numbers
 * for fields declared as type "number", while preserving all answers (including "__proto__" keys).
 */
export function normalizeDraftAnswers(
  schema: FormSchema,
  data: unknown,
): Record<string, FormValue> {
  const normalizedSchema = normalizeFormSchema(schema);
  const byKey = new Map(normalizedSchema.fields.map((f) => [f.key, f]));
  const result: Record<string, FormValue> = {};
  // Older submissions can contain any JSON value. Visibility only consumes answer
  // objects; the repository still returns the original stored value to callers.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return result;
  }
  for (const key of Object.getOwnPropertyNames(data)) {
    const field = byKey.get(key);
    let value = (data as Record<string, unknown>)[key] as FormValue;
    if (field?.type === "number" && typeof value === "string") {
      const num = parseNumericString(value);
      if (num !== null) value = num;
    }
    Object.defineProperty(result, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result;
}

/** A checkbox condition value: `""`/`"false"` mean unchecked, `"true"` means checked. */
function normalizeCheckboxConditionValue<T extends FormValue>(
  value: T,
): T | boolean {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false" || lower === "") return false;
  return value;
}

/**
 * Normalise a form schema, repairing published versions whose checkbox conditions
 * stored boolean-like strings ("true"/"false") instead of boolean values (D4), and
 * conditions left as `""` when the controlling field was later changed to a checkbox
 * (a checkbox answer is never the empty string, so that condition could never match).
 * Idempotent: a repaired schema normalises to itself.
 */
export function normalizeFormSchema(schema: FormSchema): FormSchema {
  const checkboxKeys = new Set(
    schema.fields.filter((f) => f.type === "checkbox").map((f) => f.key),
  );
  return {
    ...schema,
    fields: schema.fields.map((field) => {
      if (!field.showIf) return field;
      if (checkboxKeys.has(field.showIf.field_key)) {
        const val = field.showIf.value;
        return {
          ...field,
          showIf: {
            ...field.showIf,
            value: Array.isArray(val)
              ? val.map((item) => normalizeCheckboxConditionValue(item))
              : normalizeCheckboxConditionValue(val as FormValue),
          },
        };
      }
      return field;
    }),
  };
}

/**
 * Set of field keys referenced by at least one other field's showIf condition.
 */
export function getConditionDrivingKeys(
  schema: FormSchema,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const field of schema.fields) {
    if (field.showIf?.field_key) {
      keys.add(field.showIf.field_key);
    }
  }
  return keys;
}

/**
 * RT-5 conditional visibility for every field in the schema at once. `showIf` is the
 * exact `custom_field.visibility_condition` shape (`{ field_key, op, value }`) with all
 * four operators (`eq`/`neq`/`in`/`is_set`); `null`/`undefined` always shows (N2).
 *
 * `visibility_condition` is data-model's own "single-level" shape: `validateFormSchema`
 * rejects a `showIf` whose controller has its own `showIf` (`show_if_chained_condition`).
 * This resolver is the defense-in-depth half of that fix (N1) for a schema that skipped
 * publish validation (seeded, migrated, or an older stored version, per RT-6): a hidden
 * field's own *submitted* answer is never read to decide another field's visibility — it
 * is treated as absent, exactly as if the customer had never answered it — so a
 * controller a customer could never legitimately see cannot smuggle a value that hides
 * (via `neq`/`in`) or shows (via `eq`) a field downstream. A cycle, or any condition
 * `validateFormSchema` should already have rejected, fails **closed**: the field counts
 * as visible, so its `required` is still enforced rather than silently skippable (H1).
 */
export function resolveFormVisibility(
  schema: FormSchema,
  data: unknown,
): ReadonlyMap<string, boolean> {
  const normalized = normalizeFormSchema(schema);
  const normalizedData = normalizeDraftAnswers(normalized, data);
  const byKey = new Map(normalized.fields.map((f) => [f.key, f]));
  const cache = new Map<string, boolean>();
  const resolving = new Map<string, number>();
  const path: string[] = [];

  function resolve(field: FormField): boolean {
    const cached = cache.get(field.key);
    if (cached !== undefined) return cached;

    const condition = field.showIf;
    if (condition === undefined || condition === null) {
      cache.set(field.key, true);
      return true;
    }
    if (!isConditionWellFormed(condition)) {
      cache.set(field.key, true);
      return true;
    }
    const cycleStart = resolving.get(field.key);
    if (cycleStart !== undefined) {
      for (const key of path.slice(cycleStart)) cache.set(key, true);
      return true;
    }

    resolving.set(field.key, path.length);
    path.push(field.key);
    const controller = byKey.get(condition.field_key);
    const controllerVisible = controller === undefined || resolve(controller);
    path.pop();
    resolving.delete(field.key);

    // A cycle member stays fail-closed/visible even after recursion unwinds.
    if (cache.has(field.key)) return true;

    // N1: a hidden controller's answer never decides another field's visibility.
    let actual: FormValue = null;
    if (controllerVisible) {
      const raw = Object.hasOwn(normalizedData, condition.field_key)
        ? (normalizedData[condition.field_key] ?? null)
        : null;
      if (raw !== null) {
        actual = raw;
      } else if (controller?.type === "checkbox") {
        actual = false;
      } else if (
        controller?.type === "text" ||
        controller?.type === "textarea"
      ) {
        actual = "";
      }
    }
    const visible = isVisibilityConditionSatisfied(condition, actual);
    cache.set(field.key, visible);
    return visible;
  }

  for (const field of normalized.fields) resolve(field);
  return cache;
}

/** RT-5: does this one field show for the data submitted so far? */
export function isFieldVisible(
  schema: FormSchema,
  field: FormField,
  data: Readonly<Record<string, FormValue>>,
): boolean {
  return resolveFormVisibility(schema, data).get(field.key) ?? true;
}

/** The fields a customer actually sees for the data so far — required checks apply only here. */
export function visibleFields(
  schema: FormSchema,
  data: unknown,
): readonly FormField[] {
  const visibility = resolveFormVisibility(schema, data);
  return schema.fields.filter((f) => visibility.get(f.key) ?? true);
}

/**
 * The stored answers a reader may be shown: only keys of fields the form version declares
 * AND that are visible for these answers (RT-5), in the form's field order, with each stored
 * value unchanged. Hidden-field answers, keys the version never declared (a forged or legacy
 * key) and file fields (their files never sit in `form_data`, IQ-9) are left out. This is a
 * read-time projection for portal and triage responses; stored history is never rewritten.
 */
export function visibleSubmissionAnswers(
  schema: FormSchema,
  data: unknown,
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return answers;
  }
  const visibility = resolveFormVisibility(schema, data);
  for (const field of schema.fields) {
    if (field.type === "file" || !(visibility.get(field.key) ?? true)) continue;
    if (!Object.hasOwn(data, field.key)) continue;
    // `defineProperty`, not assignment: a field keyed `__proto__` is an own answer, and must
    // not re-target the prototype of the returned object.
    Object.defineProperty(answers, field.key, {
      value: (data as Record<string, unknown>)[field.key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return answers;
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
      // An integer beyond `Number.MAX_SAFE_INTEGER` has already lost digits: reject it.
      return typeof value === "number" && isUsableNumber(value);
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
  const normalized = normalizeFormSchema(schema);
  const normalizedData = normalizeDraftAnswers(normalized, data);
  const errors: SubmissionDataError[] = [];
  for (const field of visibleFields(normalized, normalizedData)) {
    // Own-property lookup (M1/L4): an inherited key like `toString` must not count as
    // an answer just because `data["toString"]` resolves via the prototype chain.
    const value = Object.hasOwn(normalizedData, field.key)
      ? normalizedData[field.key]
      : undefined;
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
 * Strip hidden, undeclared, and wrong-type answers from submitted form data (D5).
 * File fields transfer via the attachment table (IQ-9), never in form_data, so they are excluded.
 */
export function sanitizeSubmissionData(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): Record<string, FormValue> {
  const normalized = normalizeFormSchema(schema);
  const normalizedData = normalizeDraftAnswers(normalized, data);
  const visible = visibleFields(normalized, normalizedData);
  const drivingKeys = getConditionDrivingKeys(normalized);
  const sanitized: Record<string, FormValue> = {};
  for (const field of visible) {
    if (field.type === "file") continue;
    const hasValue = Object.hasOwn(normalizedData, field.key);
    const value = hasValue ? normalizedData[field.key] : undefined;
    const isBlank =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    if (isBlank) {
      if (
        drivingKeys.has(field.key) &&
        (field.type === "text" ||
          field.type === "textarea" ||
          field.options?.includes(""))
      ) {
        Object.defineProperty(sanitized, field.key, {
          value: "",
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      continue;
    }

    if (isValidAnswer(field, value as FormValue)) {
      if (field.options !== undefined) {
        const values = Array.isArray(value) ? value : [value];
        if (
          !values.every(
            (v) => typeof v === "string" && field.options?.includes(v),
          )
        ) {
          continue;
        }
      }
      Object.defineProperty(sanitized, field.key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  return sanitized;
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

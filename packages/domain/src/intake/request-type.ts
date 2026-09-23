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
    | "maps_to_empty"
    | "maps_to_missing_native_field";
};

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
      if (field.showIf.field === field.key) {
        defects.push({ key, problem: "show_if_self_reference" });
      } else if (!keys.has(field.showIf.field)) {
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
 * A field with no `showIf` always shows. The single defined condition — "that field
 * has this value" — is an equality on the controlling field's *submitted* value, with
 * absent-equals-absent so a checkbox the customer never touched behaves sanely.
 */
export function isFieldVisible(
  field: FormField,
  data: Readonly<Record<string, FormValue>>,
): boolean {
  if (field.showIf === undefined) return true;
  return valuesEqual(data[field.showIf.field] ?? null, field.showIf.equals);
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
  readonly problem: "required_missing" | "not_an_option";
};

/**
 * Submit-time validation (RT-5's point: a hidden field is not required — only the
 * fields *visible for this data* are checked). Unknown keys are NOT rejected: RT-3
 * stores unmapped values in `form_data`, so leniency is the spec's shape, not an
 * oversight. Select values must be within `options` when the field is visible.
 */
export function validateSubmissionData(
  schema: FormSchema,
  data: Readonly<Record<string, FormValue>>,
): readonly SubmissionDataError[] {
  const errors: SubmissionDataError[] = [];
  for (const field of visibleFields(schema, data)) {
    const value = data[field.key];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (field.required === true && missing) {
      errors.push({ key: field.key, problem: "required_missing" });
      continue;
    }
    if (!missing && field.options !== undefined) {
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
  const native: Record<string, FormValue> = {};
  for (const field of visibleFields(schema, data)) {
    const mapping = field.mapsTo;
    if (mapping === undefined) continue;
    const raw = data[field.key];
    if (raw === undefined || raw === null) continue;
    if (mapping.map !== undefined && typeof raw === "string") {
      const translated = mapping.map[raw];
      // An unmapped option keeps the raw value: dropping it silently would lose the
      // customer's answer at exactly the moment the schema drifted.
      native[mapping.field] = translated ?? raw;
    } else {
      native[mapping.field] = raw;
    }
  }
  return native;
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

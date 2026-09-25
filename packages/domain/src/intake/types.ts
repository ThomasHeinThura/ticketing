/**
 * Intake — pure data types.
 *
 * Mirrors `submission`/`submission_message`/`request_type`/`request_type_version`/
 * `organisation_request_type` as plain data (`docs/01-architecture/data-model.md`;
 * `docs/03-features/intake-queue.md`; `docs/03-features/request-types-and-catalogue.md`).
 * Database ids, sequences and row loading never appear here — an instance supplies the
 * next `number` from the sequence (IQ-2, data-model line "from an instance-wide
 * sequence, never reused") and passes the row in as plain data. No clock is read: every
 * function that needs "now" takes it as an argument.
 */

/** The six submission states (`intake-queue.md` § Statuses), snake_case as stored. */
export const SUBMISSION_STATES = [
  "new",
  "clarifying",
  "accepted",
  "declined",
  "duplicate",
  "withdrawn",
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

/**
 * A submission as plain data — exactly what a transition needs, nothing more.
 * `claimedBy`/`claimedAt` are the data model's own claim columns; together with
 * `staffMessageCount` they express IQ-16a's "the moment a triager takes any action —
 * a queue claim, a message, or starting acceptance — withdrawal is refused".
 * `clarifyingSince` is when the current `clarifying` period began (IQ-15's 14-day
 * clock); it is `null` at creation and reset when the customer replies (IQ-13).
 */
export interface SubmissionRecord {
  readonly number: number;
  readonly state: SubmissionState;
  readonly claimedBy: string | null;
  readonly claimedAt: Date | null;
  readonly clarifyingSince: Date | null;
  readonly staffMessageCount: number;
}

/** Who is acting — the permission split the specs draw (portal session vs `intake:triage`). */
export type SubmissionActor = "customer" | "triager";

/** JSON-ish form values, exactly what `form_data jsonb` holds. */
export type FormValue = string | number | boolean | null | readonly FormValue[];

/**
 * A conditional-visibility test, the exact shape `custom_field.visibility_condition`
 * uses (`data-model.md`), reused here rather than inventing a second vocabulary for
 * request-type forms (`request-types-and-catalogue.md` § Data): `{ field_key, op,
 * value }`. `value` is unused for `is_set`.
 */
export interface VisibilityCondition {
  readonly field_key: string;
  readonly op: "eq" | "neq" | "in" | "is_set";
  readonly value?: FormValue;
}

/**
 * One field of a request type's form schema
 * (`request-types-and-catalogue.md` § Data + RT-3/4/5).
 */
export interface FormField {
  readonly key: string;
  readonly type:
    | "text"
    | "textarea"
    | "select"
    | "combobox"
    | "number"
    | "date"
    | "checkbox"
    | "file";
  readonly label: string;
  readonly required?: boolean;
  readonly options?: readonly string[];
  readonly help?: string;
  readonly multiple?: boolean;
  /** RT-3/RT-4: map this field onto a native work item field, optionally translating values. */
  readonly mapsTo?: {
    readonly field: string;
    readonly map?: Readonly<Record<string, string>>;
  };
  /** RT-5 conditional visibility. */
  readonly showIf?: VisibilityCondition;
}

/** The JSONB form schema shape (`request-types-and-catalogue.md` § Data). */
export interface FormSchema {
  readonly fields: readonly FormField[];
}

/**
 * A request type as the catalogue sees it. `organisationRequestTypeRows` is the
 * per-organisation catalogue table — data-model's "No row ⇒ not visible and not
 * submittable" is THE visibility rule this module evaluates.
 */
export interface RequestTypeCatalogueEntry {
  readonly key: string;
  readonly name: string;
  readonly group: string;
  readonly position: number;
  readonly customerVisible: boolean;
  readonly autoAccept: boolean;
}

/** One `organisation_request_type` row as plain data. */
export interface OrganisationRequestTypeRow {
  readonly organisationId: string;
  readonly requestTypeKey: string;
}

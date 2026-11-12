import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
  visibleSubmissionAnswers,
} from "@taskdesk/domain/intake";

/**
 * Required fields the customer can currently see; hidden fields remain optional. A file field's
 * files never sit in the answers (they upload once the request exists, A-08), so a required file
 * field counts as answered when `hasStagedFiles` says files are waiting for it.
 */
export function missingRequiredIntakeFields(
  schema: FormSchema,
  answers: Readonly<Record<string, unknown>>,
  hasStagedFiles: (fieldKey: string) => boolean = () => false,
): readonly string[] {
  const fileFields = new Set(
    schema.fields
      .filter((field) => field.type === "file")
      .map((field) => field.key),
  );
  return validateSubmissionData(schema, answers as Record<string, FormValue>)
    .filter((error) => error.problem === "required_missing")
    .map((error) => error.key)
    .filter((key) => !(fileFields.has(key) && hasStagedFiles(key)));
}

/**
 * The answers to show, in the order the form asked them (the version's field order). The same
 * rule as the server's read-time projection: only a declared field that is visible for these
 * answers shows, so a hidden-field answer, a key the version never declared (a legacy or
 * forged key) and a file field never appear, even if an older response still carried them.
 * Fields from the portal payload are already the visible ones and carry no `showIf`.
 */
export function submissionAnswerRows(
  fields:
    | readonly {
        key: string;
        label: string;
        type?: string;
        showIf?: unknown;
      }[]
    | undefined,
  answers: Readonly<Record<string, unknown>> | undefined,
) {
  const declared = fields ?? [];
  const shown = visibleSubmissionAnswers(
    { fields: declared } as unknown as FormSchema,
    answers,
  );
  return declared
    .filter((field) => Object.hasOwn(shown, field.key))
    .map((field) => ({
      key: field.key,
      label: field.label || field.key,
      value: String(shown[field.key]),
    }));
}

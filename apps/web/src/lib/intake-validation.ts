import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
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
 * The answers in the order the form asked them (the version's field order), then any answer
 * the version no longer names (a legacy key), labelled by its key.
 */
export function submissionAnswerRows(
  fields: readonly { key: string; label: string }[] | undefined,
  answers: Readonly<Record<string, unknown>> | undefined,
) {
  const given = answers ?? {};
  const known = (fields ?? []).filter((field) =>
    Object.hasOwn(given, field.key),
  );
  const knownKeys = new Set(known.map((field) => field.key));
  return [
    ...known.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      value: String(given[field.key]),
    })),
    ...Object.entries(given)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, value]) => ({ key, label: key, value: String(value) })),
  ];
}

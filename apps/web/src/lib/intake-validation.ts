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

export function submissionAnswerRows(
  fields: readonly { key: string; label: string }[] | undefined,
  answers: Readonly<Record<string, unknown>> | undefined,
) {
  const labels = new Map(
    (fields ?? []).map((field) => [field.key, field.label]),
  );
  return Object.entries(answers ?? {}).map(([key, value]) => ({
    key,
    label: labels.get(key) || key,
    value: String(value),
  }));
}

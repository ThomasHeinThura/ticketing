import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
} from "@taskdesk/domain/intake";

/** Required fields the customer can currently see; hidden fields remain optional. */
export function missingRequiredIntakeFields(
  schema: FormSchema,
  answers: Readonly<Record<string, unknown>>,
): readonly string[] {
  return validateSubmissionData(schema, answers as Record<string, FormValue>)
    .filter((error) => error.problem === "required_missing")
    .map((error) => error.key);
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

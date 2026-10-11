import {
  type FormSchema,
  type FormValue,
  validateSubmissionData,
} from "@taskdesk/domain";

/** Required fields the customer can currently see; hidden fields remain optional. */
export function missingRequiredIntakeFields(
  schema: FormSchema,
  answers: Readonly<Record<string, unknown>>,
): readonly string[] {
  return validateSubmissionData(schema, answers as Record<string, FormValue>)
    .filter((error) => error.problem === "required_missing")
    .map((error) => error.key);
}

import { HTTPException } from "hono/http-exception";

/**
 * Stable machine codes for triage refusals. The body stays `{ error, message, ...extra }` so
 * the agent app can show a specific, translated message per code (`P2R1-12`) while API clients
 * that only read `message` are unaffected.
 */
export type IntakeErrorCode =
  | "submission_not_open"
  | "submission_already_converted"
  | "submission_changed"
  | "destination_required"
  | "destination_unavailable"
  | "work_item_type_unavailable"
  | "form_version_unavailable";

export function intakeError(
  status: 404 | 409 | 422,
  code: IntakeErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): HTTPException {
  return new HTTPException(status, {
    res: Response.json({ error: code, message, ...extra }, { status }),
  });
}

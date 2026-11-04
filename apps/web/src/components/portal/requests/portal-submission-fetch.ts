import { client } from "@taskdesk/libs";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/**
 * `GET /api/portal/submissions/:ref` for the submission page, failing with an `HttpError` that
 * keeps the status: a 404 (a missing ref, or one outside the customer's reach) then reads as
 * "not found" and is not retried, like the request page.
 */
export async function getPortalSubmissionDetail(ref: string) {
  const response = await client.portal.submissions[":ref"].$get({
    param: { ref },
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to load the submission"),
    );
  return response.json();
}

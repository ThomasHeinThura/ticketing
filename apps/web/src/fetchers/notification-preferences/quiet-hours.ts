import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";
import type { QuietHours } from "./get-notification-preferences";

/** NO-3: save (or clear, with `null`) the caller's quiet-hours window. Saved on its own. */
export async function saveQuietHours(quietHours: QuietHours | null) {
  const response = await apiFetch(getApiUrl("/notification-preferences"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quietHours }),
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to save quiet hours");
  return response.json();
}

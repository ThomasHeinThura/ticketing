import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";
export type CanonicalMentionPreference = {
  eventKind: "work_item.mentioned";
  channel: "notify.email";
  scope: "global";
  scopeId: null;
  enabled: boolean;
  digest: "off";
  source: "default" | "global";
};
export type PreferenceSelector = {
  eventKind: string;
  channel: string;
  scope: string;
  scopeId: string | null;
};
export async function getEmailLinkHandoff(): Promise<PreferenceSelector | null> {
  const response = await apiFetch(
    getApiUrl("/notification-preferences/email-link-handoff"),
    { cache: "no-store", referrerPolicy: "no-referrer" },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new HttpError(response.status, "Unable to resolve email preference");
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("eventKind" in value) ||
    typeof value.eventKind !== "string" ||
    !("channel" in value) ||
    typeof value.channel !== "string" ||
    !("scope" in value) ||
    typeof value.scope !== "string" ||
    !("scopeId" in value) ||
    (value.scopeId !== null && typeof value.scopeId !== "string")
  )
    throw new Error("Invalid preference selector");
  return value as PreferenceSelector;
}
export async function saveMentionEmailPreference(enabled: boolean) {
  const response = await apiFetch(getApiUrl("/notification-preferences"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      canonicalPreference: {
        eventKind: "work_item.mentioned",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled,
        digest: "off",
      },
    }),
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to save email preference");
  return response.json();
}

import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";
export type CanonicalMentionPreference = {
  eventKind:
    | "work_item.mentioned"
    | "work_item.commented"
    | "automation.notification_sent";
  channel: "notify.email";
  scope: "global";
  scopeId: null;
  enabled: boolean;
  digest: "off" | "hourly" | "daily";
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
async function saveCanonicalEmailPreference(
  eventKind: CanonicalMentionPreference["eventKind"],
  input: {
    enabled: boolean;
    digest: CanonicalMentionPreference["digest"];
  },
) {
  const response = await apiFetch(getApiUrl("/notification-preferences"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      canonicalPreference: {
        eventKind,
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: input.enabled,
        digest: input.digest,
      },
    }),
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to save email preference");
  return response.json();
}

export function saveMentionEmailPreference(input: {
  enabled: boolean;
  digest: CanonicalMentionPreference["digest"];
}) {
  return saveCanonicalEmailPreference("work_item.mentioned", {
    ...input,
    digest: "off",
  });
}

export function saveCommentEmailPreference(input: {
  enabled: boolean;
  digest: CanonicalMentionPreference["digest"];
}) {
  return saveCanonicalEmailPreference("work_item.commented", input);
}

export function saveTeamNotificationEmailPreference(input: {
  enabled: boolean;
  digest: CanonicalMentionPreference["digest"];
}) {
  return saveCanonicalEmailPreference("automation.notification_sent", input);
}

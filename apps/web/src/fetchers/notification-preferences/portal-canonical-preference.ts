import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type PortalCanonicalPreference = {
  eventKind: "work_item.mentioned" | "work_item.commented";
  channel: "notify.email";
  scope: "global";
  scopeId: null;
  enabled: boolean;
  digest: "off" | "hourly" | "daily";
  source: "default" | "global";
};
export type PortalPreferenceSelector = {
  eventKind: string;
  channel: string;
  scope: string;
  scopeId: string | null;
};

async function parsePreferences(
  response: Response,
): Promise<PortalCanonicalPreference[]> {
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Unable to load notification preferences",
    );
  const value: unknown = await response.json();
  if (!Array.isArray(value))
    throw new Error("Invalid notification preferences");
  return value as PortalCanonicalPreference[];
}

export async function getPortalCanonicalPreferences() {
  return parsePreferences(
    await apiFetch(getApiUrl("/portal/notification-preferences/canonical"), {
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }),
  );
}

export async function getPortalEmailLinkHandoff(): Promise<PortalPreferenceSelector | null> {
  const response = await apiFetch(
    getApiUrl("/portal/notification-preferences/email-link-handoff"),
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
  return value as PortalPreferenceSelector;
}

export async function savePortalCanonicalPreference(input: {
  eventKind: PortalCanonicalPreference["eventKind"];
  enabled: boolean;
  digest: PortalCanonicalPreference["digest"];
}) {
  const response = await apiFetch(
    getApiUrl("/portal/notification-preferences/canonical"),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventKind: input.eventKind,
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: input.enabled,
        digest: input.digest,
      }),
    },
  );
  return parsePreferences(response);
}

import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export const PORTAL_CANONICAL_EVENT_KINDS = [
  "work_item.mentioned",
  "work_item.commented",
  "work_item.transitioned",
  "submission.replied",
  "submission.declined",
  "submission.accepted",
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
] as const;
export type PortalCanonicalEventKind =
  (typeof PORTAL_CANONICAL_EVENT_KINDS)[number];
export type PortalQuietHours = { start: string; end: string; timezone: string };
export type PortalCanonicalPreference = {
  eventKind: PortalCanonicalEventKind;
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
  if (
    !Array.isArray(value) ||
    value.length !== PORTAL_CANONICAL_EVENT_KINDS.length ||
    !value.every((row: unknown) => {
      if (!row || typeof row !== "object") return false;
      const item = row as Record<string, unknown>;
      return (
        PORTAL_CANONICAL_EVENT_KINDS.some((kind) => kind === item.eventKind) &&
        item.channel === "notify.email" &&
        item.scope === "global" &&
        item.scopeId === null &&
        typeof item.enabled === "boolean" &&
        typeof item.digest === "string" &&
        ["off", "hourly", "daily"].includes(item.digest) &&
        (item.source === "default" || item.source === "global") &&
        (!(
          item.eventKind === "work_item.mentioned" ||
          item.eventKind === "approval.expiring"
        ) ||
          item.digest === "off")
      );
    }) ||
    new Set(value.map((row) => row.eventKind)).size !==
      PORTAL_CANONICAL_EVENT_KINDS.length
  )
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
        digest:
          input.eventKind === "work_item.mentioned" ||
          input.eventKind === "approval.expiring"
            ? "off"
            : input.digest,
      }),
    },
  );
  return parsePreferences(response);
}

async function parseQuietHours(
  response: Response,
): Promise<PortalQuietHours | null> {
  if (!response.ok)
    throw new HttpError(response.status, "Unable to load quiet hours");
  const value: unknown = await response.json();
  if (value === null) return null;
  if (!value || typeof value !== "object")
    throw new Error("Invalid quiet hours");
  const item = value as Record<string, unknown>;
  const validTime = (time: unknown) =>
    typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (
    !validTime(item.start) ||
    !validTime(item.end) ||
    item.start === item.end ||
    typeof item.timezone !== "string" ||
    !item.timezone ||
    item.timezone.length > 128
  )
    throw new Error("Invalid quiet hours");
  try {
    new Intl.DateTimeFormat("en", { timeZone: item.timezone });
  } catch {
    throw new Error("Invalid quiet hours");
  }
  return {
    start: item.start as string,
    end: item.end as string,
    timezone: item.timezone,
  };
}

export async function getPortalQuietHours() {
  return parseQuietHours(
    await apiFetch(
      getApiUrl("/portal/notification-preferences/canonical/quiet-hours"),
      {
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    ),
  );
}
export async function savePortalQuietHours(
  quietHours: PortalQuietHours | null,
) {
  return parseQuietHours(
    await apiFetch(
      getApiUrl("/portal/notification-preferences/canonical/quiet-hours"),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quietHours }),
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    ),
  );
}

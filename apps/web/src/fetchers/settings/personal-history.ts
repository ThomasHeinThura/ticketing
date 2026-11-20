import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";
import { refreshPersonalHistory } from "./personal-history-refresh";

export {
  capturePreferencesHistoryRefresh,
  preferencesHistoryKey,
  refreshPersonalHistory,
} from "./personal-history-refresh";

export const profileHistoryKey = (userId: string, sessionId: string) =>
  [
    "personal-settings-history",
    window.location.host,
    "profile",
    userId,
    sessionId,
  ] as const;

export type PersonalHistoryAudience = "staff" | "portal";

export const notificationHistoryKey = (
  audience: PersonalHistoryAudience,
  userId: string,
  sessionId: string,
  host = window.location.host,
) =>
  [
    "personal-settings-history",
    host,
    "notifications",
    audience,
    userId,
    sessionId,
  ] as const;

export async function assertNotificationHistorySession(
  audience: PersonalHistoryAudience,
  userId: string,
  sessionId: string,
  host: string,
) {
  if (window.location.host !== host) throw new HttpError(403, "Host changed");
  const result =
    audience === "staff"
      ? await (await import("@/lib/auth-client")).authClient.getSession({
          query: { disableCookieCache: true },
        })
      : await (
          await import("@/lib/portal-auth-client")
        ).portalAuthClient.getSession();
  if (result.error)
    throw new HttpError(result.error.status, "Session unavailable");
  if (
    window.location.host !== host ||
    result.data?.user?.id !== userId ||
    result.data.session?.id !== sessionId
  )
    throw new HttpError(403, "Session changed");
}

export function captureNotificationHistoryRefresh(
  client: QueryClient,
  audience: PersonalHistoryAudience,
  identity?: { user?: { id: string }; session?: { id: string } } | null,
) {
  const userId = identity?.user?.id;
  const sessionId = identity?.session?.id;
  const host = window.location.host;
  if (!userId || !sessionId) return () => {};
  const key = notificationHistoryKey(audience, userId, sessionId, host);
  return () => refreshPersonalHistory(client, key);
}

export async function getNotificationHistory(
  audience: PersonalHistoryAudience,
  signal: AbortSignal,
) {
  const path =
    audience === "portal"
      ? "portal/account/settings-history?section=notifications"
      : "me/settings/history?section=notifications";
  const response = await fetch(getApiUrl(path), {
    credentials: "include",
    signal,
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load history");
  const entry = z.object({
    at: z.string().datetime(),
    actor: z.literal("you"),
  });
  return z
    .object({
      section: z.literal("notifications"),
      lastChanged: entry.nullable(),
      rows: z.array(
        entry.extend({
          changedCategories: z
            .array(
              z.enum(["delivery", "digest", "quietHours", "workspaceRule"]),
            )
            .optional(),
        }),
      ),
    })
    .parse(await response.json());
}

export async function getProfileHistory(signal: AbortSignal) {
  const response = await fetch(
    getApiUrl("me/settings/history?section=profile"),
    {
      credentials: "include",
      signal,
    },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load history");
  const entry = z.object({
    at: z.string().datetime(),
    actor: z.literal("you"),
  });
  return z
    .object({
      section: z.literal("profile"),
      lastChanged: entry.nullable(),
      rows: z.array(
        entry.extend({
          changedFields: z
            .array(z.enum(["name", "locale", "image"]))
            .optional(),
        }),
      ),
    })
    .parse(await response.json());
}

export async function getPreferencesHistory(signal: AbortSignal) {
  const response = await fetch(
    getApiUrl("me/settings/history?section=preferences"),
    { credentials: "include", signal },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load history");
  const entry = z.object({
    at: z.string().datetime(),
    actor: z.literal("you"),
  });
  return z
    .object({
      section: z.literal("preferences"),
      lastChanged: entry.nullable(),
      rows: z.array(
        entry.extend({
          changedFields: z
            .array(
              z.enum([
                "density",
                "layout",
                "listGroups",
                "columns",
                "columnWidths",
              ]),
            )
            .optional(),
        }),
      ),
    })
    .parse(await response.json());
}

export type PersonalSelfHistorySection = "security" | "apiKeys";

export const personalSelfHistoryKey = (
  section: PersonalSelfHistorySection,
  audience: PersonalHistoryAudience,
  userId: string,
  sessionId: string,
  host = window.location.host,
) =>
  [
    "personal-settings-history",
    host,
    section,
    audience,
    userId,
    sessionId,
  ] as const;

export function capturePersonalSelfHistoryRefresh(
  client: QueryClient,
  section: PersonalSelfHistorySection,
  audience: PersonalHistoryAudience,
  identity?: { user?: { id: string }; session?: { id: string } } | null,
) {
  const userId = identity?.user?.id;
  const sessionId = identity?.session?.id;
  const host = window.location.host;
  if (!userId || !sessionId || (section === "apiKeys" && audience !== "staff"))
    return () => {};
  const key = personalSelfHistoryKey(
    section,
    audience,
    userId,
    sessionId,
    host,
  );
  return () => refreshPersonalHistory(client, key);
}

export async function getPersonalSelfHistory(
  section: PersonalSelfHistorySection,
  audience: PersonalHistoryAudience,
  signal: AbortSignal,
) {
  if (section === "apiKeys" && audience !== "staff")
    throw new HttpError(403, "History unavailable");
  const path =
    audience === "portal"
      ? "portal/account/settings-history?section=security"
      : `me/settings/history?section=${section}`;
  const response = await fetch(getApiUrl(path), {
    credentials: "include",
    signal,
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load history");
  const entry = z.object({
    at: z.string().datetime(),
    actor: z.literal("you"),
  });
  const categories =
    section === "apiKeys"
      ? z.enum(["personalKey"])
      : audience === "portal"
        ? z.enum(["password"])
        : z.enum(["password", "mfa"]);
  return z
    .object({
      section: z.literal(section),
      lastChanged: entry.nullable(),
      rows: z.array(entry.extend({ changedCategories: z.array(categories) })),
    })
    .parse(await response.json());
}

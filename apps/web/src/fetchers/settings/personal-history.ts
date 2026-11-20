import { z } from "zod";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type SelfHistoryTarget =
  | {
      audience: "staff";
      section:
        | "profile"
        | "preferences"
        | "notifications"
        | "security"
        | "apiKeys";
    }
  | { audience: "portal"; section: "profile" | "notifications" | "security" };

// Each section's closed set of change markers, and the response field that carries them.
const SECTIONS = {
  profile: ["changedFields", ["name", "locale", "image"]],
  preferences: [
    "changedFields",
    ["density", "layout", "listGroups", "columns", "columnWidths"],
  ],
  notifications: [
    "changedCategories",
    ["delivery", "digest", "quietHours", "workspaceRule"],
  ],
  security: ["changedCategories", ["password", "mfa"]],
  apiKeys: ["changedCategories", ["personalKey"]],
} as const;

const entry = z.object({ at: z.string().datetime(), actor: z.literal("you") });

/** The signed-in person's own History for one account section, rows normalised to `changed`. */
export async function getSelfHistory(
  { audience, section }: SelfHistoryTarget,
  signal: AbortSignal,
) {
  const response = await fetch(
    getApiUrl(
      audience === "portal"
        ? `portal/account/settings-history?section=${section}`
        : `me/settings/history?section=${section}`,
    ),
    { credentials: "include", signal },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load history");
  const [field, markers] = SECTIONS[section];
  const marker = z.enum(
    audience === "portal" && section === "security" ? ["password"] : markers,
  );
  const body = z
    .object({
      section: z.literal(section),
      lastChanged: entry.nullable(),
      rows: z.array(
        entry.extend({
          changedFields: z.array(marker).optional(),
          changedCategories: z.array(marker).optional(),
        }),
      ),
    })
    .parse(await response.json());
  return {
    section,
    lastChanged: body.lastChanged,
    rows: body.rows.map((row) => ({
      at: row.at,
      changed: row[field] ?? [],
    })),
  };
}

export type SelfHistory = Awaited<ReturnType<typeof getSelfHistory>>;

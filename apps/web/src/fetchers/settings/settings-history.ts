import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { z } from "zod";
import { HttpError } from "@/lib/http-error";

export type SettingsHistory = InferResponseType<typeof client.audit.$get, 200>;
export type SettingsHistoryTarget =
  | Exclude<SettingsHistory["entityType"], "user_preference">
  // Selector-only: the response reports the workspace or project they edit.
  | "workspace_features"
  | "project_features";
export type SettingsHistoryScope =
  | { scope: "instance" }
  | { scope: "workspace"; workspaceId: string };

/** The entity type the API reports for a request: the Features selectors answer as their owner. */
export const historyResponseType = (type: SettingsHistoryTarget) =>
  type === "workspace_features"
    ? "workspace"
    : type === "project_features"
      ? "project"
      : type;

const actor = z.strictObject({
  kind: z.enum(["person", "api_key", "automation", "system"]),
  name: z.string().nullable(),
});
const responseSchema = z.strictObject({
  entityType: z.string(),
  entityId: z.string(),
  workspaceId: z.string().nullable(),
  projectId: z.string().nullable(),
  lastChanged: z.strictObject({ actor, at: z.string().datetime() }).nullable(),
  rows: z.array(
    z.strictObject({
      at: z.string().datetime(),
      actor,
      action: z.string(),
      changedFields: z.array(z.string()),
    }),
  ),
});

export async function getSettingsHistory(
  type: SettingsHistoryTarget,
  id: string,
  signal?: AbortSignal,
  selector?: SettingsHistoryScope,
) {
  const response = await client.audit.$get(
    {
      query: {
        entity_type: type,
        entity_id: id,
        ...(selector
          ? {
              scope: selector.scope,
              ...(selector.scope === "workspace"
                ? { workspace_id: selector.workspaceId }
                : {}),
            }
          : {}),
      },
    },
    ...(signal ? ([{ init: { signal } }] as const) : []),
  );
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load settings history");
  const data = responseSchema.parse(await response.json());
  if (data.entityType !== historyResponseType(type) || data.entityId !== id) {
    throw new Error("Unexpected settings history target");
  }
  return data as SettingsHistory;
}

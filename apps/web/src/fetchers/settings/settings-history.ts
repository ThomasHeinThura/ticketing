import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type SettingsHistory = InferResponseType<typeof client.audit.$get, 200>;
export type SettingsHistoryTarget = Exclude<
  SettingsHistory["entityType"],
  "user_preference"
>;
export type SettingsHistoryScope =
  | { scope: "instance" }
  | { scope: "workspace"; workspaceId: string };

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
  const data = await response.json();
  if (data.entityType !== type || data.entityId !== id) {
    throw new Error("Unexpected settings history target");
  }
  return data;
}

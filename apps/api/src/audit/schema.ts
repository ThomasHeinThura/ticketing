import { z } from "../openapi";
import {
  terminologyAudienceSchema,
  terminologyLocaleSchema,
  terminologyTermKeySchema,
} from "../terminology/schema";

/** Shared list query for both audit routes — the spec tables no params, so this is the
 * minimum honest surface: bounded page size, optional action-prefix and time window. */
export const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Dotted action prefix — `auth.` matches the whole auth-lifecycle group. */
  action: z.string().max(200).optional(),
  /** ISO-8601 instants, inclusive `since`, exclusive `until`. */
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  /** Exact entity filter (`entity_type` + `entity_id`), AU-10 reach still applies. */
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().min(1).max(200).optional(),
});

export const settingsHistoryQuery = z.object({
  entity_type: z.enum([
    "instance",
    "workspace",
    "project",
    "role",
    "workflow",
    "team",
    "service_calendar",
    "sla_policy",
    "request_type",
    "custom_field",
    "custom_field_section",
    "state_template",
    "webhook",
    "canned_response",
    "workspace_label",
    "project_label",
    "automation",
    "state",
    "time_activity",
    "cost_type",
    "hourly_rate",
    "budget",
    "workspace_member",
    "project_membership",
    "instance_notification_provider",
    "instance_storage_draft",
    "instance_auth_methods",
    "staff_self_registration",
    "instance_job",
    "identity_connection",
    "import_source_connection",
    "terminology_override",
    "project_estimates",
    "service_api_key",
  ]),
  entity_id: z
    .string()
    .min(1)
    .max(200)
    .refine((id) => !id.includes("\u0000")),
  scope: z.enum(["instance", "workspace"]).optional(),
  workspace_id: z.string().min(1).max(200).optional(),
});
export type SettingsHistoryEntityType = z.infer<
  typeof settingsHistoryQuery
>["entity_type"];

/** The catalogue cell, not a physical override row, is the durable history target. */
export function validTerminologyHistoryCell(id: string): boolean {
  const parts = id.split(":");
  return (
    parts.length === 3 &&
    terminologyTermKeySchema.safeParse(parts[0]).success &&
    terminologyAudienceSchema.safeParse(parts[1]).success &&
    terminologyLocaleSchema.safeParse(parts[2]).success
  );
}

/** Only terminology uses these query fields; reject duplicates and ignored selectors. */
export function parseTerminologyHistoryScope(
  query: URLSearchParams,
  id: string,
): { scope: "instance" | "workspace"; workspaceId: string | null } | null {
  const allowed = new Set([
    "entity_type",
    "entity_id",
    "scope",
    "workspace_id",
  ]);
  if (
    !validTerminologyHistoryCell(id) ||
    [...query.keys()].some(
      (key) => !allowed.has(key) || query.getAll(key).length !== 1,
    )
  )
    return null;
  const scope = query.get("scope");
  const workspaceId = query.get("workspace_id");
  if (scope === "instance" && workspaceId === null)
    return { scope, workspaceId: null };
  if (
    scope === "workspace" &&
    workspaceId &&
    workspaceId.length <= 200 &&
    !workspaceId.includes("\u0000")
  )
    return { scope, workspaceId };
  return null;
}

/** Hard ceiling on one export (AU-13): the response is a single bounded document. */
export const AUDIT_EXPORT_MAX_ROWS = 5000;

export const auditExportBody = z
  .object({
    format: z.enum(["csv", "json"]).default("csv"),
    action: z.string().max(200).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.string().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(AUDIT_EXPORT_MAX_ROWS)
      .default(AUDIT_EXPORT_MAX_ROWS),
  })
  .strict();

export const auditEntityParam = z.object({
  type: z.enum(["work_item"]),
  id: z.string().min(1).max(200),
});

export const reconstructQuery = z.object({
  at: z.string().datetime(),
});

export const workspaceIdParam = z.object({ workspaceId: z.string() });

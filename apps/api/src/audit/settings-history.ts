import { isDeepStrictEqual } from "node:util";
import type { Capability, ResolvedIdentity } from "@taskdesk/permissions";
import { can, reaches } from "@taskdesk/permissions";
import { and, eq, exists, isNotNull, isNull, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { agileFeatureEnabled } from "../agile/feature";
import { portalForHost } from "../auth";
import db, { schema } from "../database";
import {
  customFieldSectionTable,
  customFieldTable,
} from "../database/migration-schema";
import {
  apiKeyExtensionTable,
  apikeyTable,
  automationTable,
  cannedResponseTable,
  labelTable,
  stateTable,
  webhookTable,
} from "../database/schema";
import { importSourceConnectionTable } from "../database/schema-imports";
import { instanceJobConfigurationTable } from "../database/schema-instance-jobs";
import {
  budgetTable,
  costTypeTable,
  hourlyRateTable,
  timeActivityTable,
} from "../database/schema-p5-time";
import {
  LOCAL_AUTH_METHOD_PLUGINS,
  LOCAL_AUTH_PORTALS,
} from "../instance/auth-local-methods-schema";
import { requireCurrentInstanceAdmin } from "../instance/require-instance-admin";
import { settingsFields } from "../instance/settings/schema";
import { EMAIL_PLUGIN_ID } from "../notification-provider/repository";
import {
  type AuthenticatedApiKey,
  resolveRequestIdentity,
} from "../permissions/resolve-request-identity";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import { registeredJobCatalog } from "../scheduler";
import {
  S3_DRAFT_INSTANCE_KEY,
  S3_DRAFT_PLUGIN_ID,
} from "../storage/s3-draft-repository";
import {
  COST_TRACKING_FEATURE_KEY,
  TIME_TRACKING_FEATURE_KEY,
  trackingFeatureEnabled,
  trackingFeatureReachable,
} from "../time-tracking/feature";
import { apiKeyScopeSatisfies } from "../utils/require-api-key-permission-scope";
import { assertCallerHasCapability } from "../utils/require-workspace-capability";
import { writeAuditRead } from "./controllers/audit-read-common";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "./repository";
import {
  parseTerminologyHistoryScope,
  type SettingsHistoryEntityType,
  settingsHistoryQuery,
} from "./schema";

type HistoryScope = {
  type: SettingsHistoryEntityType;
  id: string;
  workspaceId: string | null;
  projectId?: string | null;
  auditEntityId?: string;
  sessionId?: string;
  apiKeyId?: string;
};

const P3_CAPABILITIES = {
  instance_notification_provider: "instance:manage_plugins",
  instance_storage_draft: "instance:admin",
  instance_auth_methods: "instance:admin",
  staff_self_registration: "instance:admin",
  instance_job: "instance:manage_jobs",
  identity_connection: "instance:admin",
  import_source_connection: "instance:admin",
} as const satisfies Partial<Record<SettingsHistoryEntityType, Capability>>;

const AUTH_METHOD_FIELDS = new Set(
  LOCAL_AUTH_PORTALS.flatMap((portal) =>
    LOCAL_AUTH_METHOD_PLUGINS.map(([, method]) => `${portal}.${method}`),
  ),
);

const PREFERENCE_FIELDS = [
  "density",
  "layout",
  "listGroups",
  "columns",
  "columnWidths",
] as const;
type PreferenceField = (typeof PREFERENCE_FIELDS)[number];
const PREFERENCE_FIELD_SET: ReadonlySet<string> = new Set(PREFERENCE_FIELDS);
const validBackdateLimit = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 3650;
const HISTORY_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  "instance.settings_changed": new Set(Object.keys(settingsFields)),
  "workspace.settings_updated": new Set([
    "name",
    "slug",
    "logo",
    "description",
  ]),
  "workspace.project_settings_updated": new Set([
    "defaultSlaPolicyId",
    "defaultServiceCalendarId",
  ]),
  "project.settings_updated": new Set([
    "slaPolicy",
    "serviceCalendar",
    "stateSetMode",
  ]),
  "project.general_settings_updated": new Set([
    "name",
    "icon",
    "slug",
    "description",
    "kind",
    "supportLevel",
    "serviceCalendarId",
    "defaultCommentVisibility",
    "managerId",
    "startDate",
    "endDate",
    "defaultAssigneeId",
    "health",
  ]),
  "project.states_updated": new Set(["stateSetMode", "position", "isDefault"]),
  "workflow.created": new Set(["definition"]),
  "workflow.version_created": new Set(["definition"]),
  "workflow.version_published": new Set(["activeVersion"]),
  "label.catalogue_created": new Set(["name", "color"]),
  "label.catalogue_updated": new Set(["name", "color"]),
  "label.catalogue_deleted": new Set(["name", "color"]),
  "canned_response.created": new Set(["name", "body", "visibilityDefault"]),
  "canned_response.updated": new Set(["name", "body", "visibilityDefault"]),
  "canned_response.deleted": new Set(["name", "body", "visibilityDefault"]),
  "state_template.created": new Set(["created", "enabled"]),
  "state_template.updated": new Set(["name", "group", "enabled"]),
};

/** A self read exposes only the closed setting names, even for old or malformed audit rows. */
export function safePreferenceAuditFields(after: unknown): PreferenceField[] {
  if (!after || typeof after !== "object" || !("changedFields" in after))
    return [];
  const fields = after.changedFields;
  return Array.isArray(fields)
    ? [
        ...new Set(
          fields.filter(
            (field): field is PreferenceField =>
              typeof field === "string" && PREFERENCE_FIELD_SET.has(field),
          ),
        ),
      ]
    : [];
}

/** Screen history never returns a raw audit payload or unrelated scope IDs. */
export function entityHistoryRow(
  row: {
    createdAt: Date | string;
    actorType: string;
    action: string;
    entityType?: string;
    entityId?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    after: unknown;
    before?: unknown;
  },
  actorName: string | null,
  selector?: SettingsHistoryEntityType,
) {
  const allowed = HISTORY_FIELDS[row.action];
  const key =
    row.action === "instance.settings_changed"
      ? "changedKeys"
      : "changedFields";
  const changed =
    row.after && typeof row.after === "object"
      ? (row.after as Record<string, unknown>)[key]
      : undefined;
  let fields =
    allowed && Array.isArray(changed)
      ? changed.filter(
          (field): field is string =>
            typeof field === "string" && allowed.has(field),
        )
      : [];
  const before =
    row.before && typeof row.before === "object" && !Array.isArray(row.before)
      ? (row.before as Record<string, unknown>)
      : null;
  const after =
    row.after && typeof row.after === "object" && !Array.isArray(row.after)
      ? (row.after as Record<string, unknown>)
      : null;
  const changedSnapshotFields = (keys: readonly string[]) =>
    before && after
      ? keys.filter(
          (field) =>
            Object.hasOwn(before, field) &&
            Object.hasOwn(after, field) &&
            !isDeepStrictEqual(before[field], after[field]),
        )
      : [];
  if (row.action === "automation.updated")
    fields = changedSnapshotFields([
      "name",
      "enabled",
      "trigger",
      "scheduleCron",
      "conditions",
      "actions",
      "projectFilter",
      "effectiveRoleId",
      "stopProcessing",
      "position",
    ]);
  else if (
    row.action === "automation.enabled" ||
    row.action === "automation.disabled"
  )
    fields = typeof after?.enabled === "boolean" ? ["enabled"] : [];
  else if (row.action === "state.wip_limit_changed")
    fields = changedSnapshotFields(["wipLimit"]);
  else if (row.action === "time_activity.created")
    fields = typeof after?.name === "string" ? ["name"] : [];
  else if (row.action === "time_activity.updated")
    fields = changedSnapshotFields(["name", "archived"]);
  else if (row.action === "cost_type.created")
    fields = ["name", "unit", "currency", "billable", "hasDefaultRate"].filter(
      (field) => Object.hasOwn(after ?? {}, field),
    );
  else if (row.action === "cost_type.updated")
    fields = changedSnapshotFields([
      "name",
      "unit",
      "currency",
      "billable",
      "archived",
    ]);
  else if (row.action === "hourly_rate.created")
    fields = after?.rateSet === true ? ["rateSet"] : [];
  else if (row.action === "membership.changed")
    fields =
      typeof before?.role === "string" &&
      typeof after?.role === "string" &&
      before.role !== after.role &&
      (after.kind === "member_role_changed" ||
        (after.source === "project_roster" && after.change === "role_changed"))
        ? ["role"]
        : [];
  else if (
    selector === "instance_notification_provider" &&
    row.action === "plugin.changed" &&
    row.entityType === "instance_plugin_config" &&
    after?.pluginId === EMAIL_PLUGIN_ID
  )
    fields = Array.isArray(after.changedKeys)
      ? [
          ...new Set(
            after.changedKeys.flatMap((key: unknown) =>
              key === "config"
                ? ["configuration"]
                : key === "password"
                  ? ["credential"]
                  : [],
            ),
          ),
        ]
      : [];
  else if (
    row.action === "plugin.changed" &&
    row.entityType === "instance_plugin_config" &&
    row.entityId === "auth.local-methods"
  )
    fields = Array.isArray(after?.changedKeys)
      ? [
          ...new Set(
            after.changedKeys.filter(
              (key): key is string =>
                typeof key === "string" && AUTH_METHOD_FIELDS.has(key),
            ),
          ),
        ]
      : [];
  else if (
    row.action === "plugin.changed" &&
    row.entityType === "instance_setting" &&
    row.entityId === "staff_self_registration_enabled"
  )
    fields =
      typeof before?.enabled === "boolean" &&
      typeof after?.enabled === "boolean" &&
      before.enabled !== after.enabled
        ? ["enabled"]
        : [];
  else if (row.action === "job.configuration_changed")
    fields = changedSnapshotFields(["pattern", "enabled"]);
  else if (
    row.action === "time_settings.updated" &&
    selector === "workspace" &&
    row.entityType === "workspace" &&
    typeof row.entityId === "string" &&
    row.entityId.length > 0 &&
    row.entityId === row.workspaceId &&
    row.projectId === null &&
    after?.operation === "workspace_time_settings_split_v1" &&
    !Object.hasOwn(after, "projectDefaultBillable")
  ) {
    const change = after.backdateLimitDays;
    if (change && typeof change === "object" && !Array.isArray(change)) {
      const { from, to } = change as Record<string, unknown>;
      fields =
        validBackdateLimit(from) && validBackdateLimit(to) && from !== to
          ? ["backdateLimitDays"]
          : [];
    }
  } else if (
    row.action === "time_settings.updated" &&
    selector === "project" &&
    row.entityType === "project" &&
    typeof row.entityId === "string" &&
    row.entityId.length > 0 &&
    row.entityId === row.projectId &&
    typeof row.workspaceId === "string" &&
    row.workspaceId.length > 0 &&
    after?.operation === "project_time_settings_split_v1" &&
    !Object.hasOwn(after, "backdateLimitDays")
  ) {
    const change = after.projectDefaultBillable;
    if (change && typeof change === "object" && !Array.isArray(change)) {
      const { projectId, from, to } = change as Record<string, unknown>;
      fields =
        projectId === row.entityId &&
        typeof from === "boolean" &&
        typeof to === "boolean" &&
        from !== to
          ? ["projectDefaultBillable"]
          : [];
    }
  }
  const kind: "person" | "api_key" | "automation" | "system" =
    row.actorType === "person" ||
    row.actorType === "api_key" ||
    row.actorType === "automation"
      ? row.actorType
      : "system";
  return {
    at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    actor: {
      kind,
      name: row.actorType === "person" ? actorName : null,
    },
    action: row.action,
    changedFields: fields,
  };
}

async function projectTargetScope(
  c: Context,
  identity: ResolvedIdentity,
  type: SettingsHistoryEntityType,
  id: string,
  projectId: string,
  expectedWorkspaceId: string | null,
  capability: Capability | null,
): Promise<HistoryScope> {
  const [row] = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.projectTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
    )
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        isNull(schema.projectTable.deletedAt),
        expectedWorkspaceId === null
          ? undefined
          : eq(schema.projectTable.workspaceId, expectedWorkspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "History not found" });
  const ancestorProjectIds = await loadProjectAncestorIdsFor(
    c,
    db,
    identity,
    row.workspaceId,
    row.id,
  );
  const ownerTeamId = await loadProjectOwnerTeamIdFor(
    db,
    identity,
    row.workspaceId,
    row.id,
  );
  const facts = {
    projectId: row.id,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    ancestorProjectIds,
    ownerTeamId,
  };
  if (!reaches(identity, facts))
    throw new HTTPException(404, { message: "History not found" });
  if (
    capability &&
    !can(identity, capability, "project", {
      projectId: row.id,
      workspaceId: row.workspaceId,
      ancestorProjectIds,
    })
  )
    throw new HTTPException(403, { message: "Forbidden" });
  c.set("workspaceId", row.workspaceId);
  c.set("workspaceIdSource", "row");
  c.set("projectId", row.id);
  c.set("projectReachFacts", facts);
  c.set("policyScopeResource", "project");
  return { type, id, workspaceId: row.workspaceId, projectId: row.id };
}

function requireWorkspaceHistoryReach(
  identity: ResolvedIdentity,
  workspaceId: string,
) {
  if (
    identity.side !== "staff" ||
    !(
      identity.reach.kind === "all" ||
      (identity.reach.kind === "membership_with_workspaces" &&
        identity.reach.workspaceIds.includes(workspaceId)) ||
      identity.memberships.some(
        (membership) =>
          membership.scope === "workspace" &&
          membership.scopeId === workspaceId,
      )
    )
  )
    throw new HTTPException(404, { message: "History not found" });
}

/** Load the addressed row and its tenant before the strict and shadow policy evaluators run. */
export async function settingsHistoryScope(c: Context, next: Next) {
  const parsed = settingsHistoryQuery.safeParse({
    entity_type: c.req.query("entity_type"),
    entity_id: c.req.query("entity_id"),
    scope: c.req.query("scope"),
    workspace_id: c.req.query("workspace_id"),
  });
  if (!parsed.success)
    throw new HTTPException(400, { message: "Invalid history target" });
  const { entity_type: type, entity_id: id } = parsed.data;
  const userId = c.get("userId") as string | undefined;
  const apiKey = c.get("apiKey") as AuthenticatedApiKey | undefined;
  const session = c.get("session") as {
    id?: string;
    portal?: string;
    impersonatedBy?: string | null;
  } | null;
  const identity =
    userId || apiKey?.service
      ? await resolveRequestIdentity({
          userId: userId ?? "",
          apiKey,
          impersonatedBy: session?.impersonatedBy,
        })
      : null;
  if (!identity) throw new HTTPException(401, { message: "Unauthorized" });
  if (
    (type === "role" ||
      type === "state_template" ||
      type === "workspace_member" ||
      type === "service_api_key" ||
      Object.hasOwn(P3_CAPABILITIES, type)) &&
    (c.get("apiKey") || !session || session.impersonatedBy)
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "Session required" });
  }

  let scope: HistoryScope;
  if (type === "terminology_override" || type === "project_estimates") {
    if (
      portalForHost(c.req.header("host")) !== "agent" ||
      identity.side !== "staff" ||
      session?.impersonatedBy ||
      (session && session.portal !== "agent")
    )
      throw new HTTPException(403, { message: "Forbidden" });
    if (type === "terminology_override") {
      const target = parseTerminologyHistoryScope(
        new URL(c.req.url).searchParams,
        id,
      );
      if (!target)
        throw new HTTPException(400, { message: "Invalid history target" });
      if (target.scope === "instance") {
        await requireCurrentInstanceAdmin(
          c,
          "GET",
          "/api/instance/terminology",
        );
        scope = {
          type,
          id,
          workspaceId: null,
          projectId: null,
          ...(apiKey ? { apiKeyId: apiKey.id } : {}),
        };
      } else {
        const workspaceId = target.workspaceId as string;
        const [row] = await db
          .select({ id: schema.workspaceTable.id })
          .from(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, workspaceId))
          .limit(1);
        if (!row)
          throw new HTTPException(404, { message: "History not found" });
        requireWorkspaceHistoryReach(identity, workspaceId);
        if (
          !apiKeyScopeSatisfies(apiKey, { workspace: ["manage_settings"] }) ||
          !can(identity, "workspace:manage_settings", "workspace", {
            workspaceId,
          })
        )
          throw new HTTPException(403, { message: "Forbidden" });
        c.set("workspaceId", workspaceId);
        c.set("workspaceIdSource", "row");
        scope = {
          type,
          id,
          workspaceId,
          projectId: null,
          ...(apiKey ? { apiKeyId: apiKey.id } : {}),
        };
      }
    } else {
      if (
        parsed.data.scope !== undefined ||
        parsed.data.workspace_id !== undefined
      )
        throw new HTTPException(400, { message: "Invalid history target" });
      scope = await projectTargetScope(
        c,
        identity,
        type,
        id,
        id,
        null,
        "project:read",
      );
      if (apiKey) scope.apiKeyId = apiKey.id;
      if (
        !(await agileFeatureEnabled(
          "feature.estimates",
          scope.workspaceId as string,
          id,
        ))
      )
        throw new HTTPException(404, { message: "feature_disabled" });
    }
  } else if (type === "service_api_key") {
    if (
      parsed.data.scope !== undefined ||
      parsed.data.workspace_id !== undefined
    )
      throw new HTTPException(400, { message: "Invalid history target" });
    if (
      portalForHost(c.req.header("host")) !== "agent" ||
      !session?.id ||
      session.portal !== "agent" ||
      identity.side !== "staff" ||
      identity.credential !== "session" ||
      !userId
    )
      throw new HTTPException(403, { message: "Forbidden" });
    const [key] = await db
      .select({ workspaceId: apiKeyExtensionTable.workspaceId })
      .from(apikeyTable)
      .innerJoin(
        apiKeyExtensionTable,
        eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
      )
      .where(
        and(
          eq(apikeyTable.id, id),
          isNotNull(apiKeyExtensionTable.workspaceId),
          isNull(apiKeyExtensionTable.personId),
          eq(apiKeyExtensionTable.isMcp, false),
        ),
      )
      .limit(1);
    const workspaceId = key?.workspaceId;
    if (!workspaceId)
      throw new HTTPException(404, { message: "History not found" });
    const [workspace] = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId))
      .limit(1);
    if (!workspace)
      throw new HTTPException(404, { message: "History not found" });
    requireWorkspaceHistoryReach(identity, workspaceId);
    await assertCallerHasCapability(workspaceId, userId, "api_key:manage", {
      kind: "session",
    });
    c.set("workspaceId", workspaceId);
    c.set("workspaceIdSource", "row");
    scope = {
      type,
      id,
      workspaceId,
      projectId: null,
      sessionId: session.id,
    };
  } else if (type === "instance") {
    if (
      id !== "singleton" ||
      !can(identity, "instance:admin", "instance", { instance: true })
    )
      throw new HTTPException(403, { message: "Forbidden" });
    const [row] = await db
      .select({ id: schema.instanceSettingTable.id })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "History not found" });
    scope = { type, id, workspaceId: null };
  } else if (Object.hasOwn(P3_CAPABILITIES, type)) {
    const capability = P3_CAPABILITIES[type as keyof typeof P3_CAPABILITIES];
    if (
      portalForHost(c.req.header("host")) !== "agent" ||
      !session?.id ||
      session?.portal !== "agent" ||
      identity.side !== "staff" ||
      identity.credential !== "session" ||
      !can(identity, capability, "instance", { instance: true })
    )
      throw new HTTPException(403, { message: "Forbidden" });
    let workspaceId: string | null = null;
    if (
      type === "instance_notification_provider" ||
      type === "instance_storage_draft"
    ) {
      const [row] = await db
        .select({ id: schema.instancePluginConfigTable.id })
        .from(schema.instancePluginConfigTable)
        .where(
          and(
            eq(schema.instancePluginConfigTable.id, id),
            eq(
              schema.instancePluginConfigTable.pluginId,
              type === "instance_notification_provider"
                ? EMAIL_PLUGIN_ID
                : S3_DRAFT_PLUGIN_ID,
            ),
            eq(
              schema.instancePluginConfigTable.instanceKey,
              type === "instance_notification_provider"
                ? "default"
                : S3_DRAFT_INSTANCE_KEY,
            ),
            eq(schema.instancePluginConfigTable.scope, "instance"),
            isNull(schema.instancePluginConfigTable.workspaceId),
            isNull(schema.instancePluginConfigTable.portalScope),
          ),
        )
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "History not found" });
    } else if (type === "instance_auth_methods") {
      if (id !== "auth.local-methods")
        throw new HTTPException(404, { message: "History not found" });
    } else if (type === "staff_self_registration") {
      if (id !== "staff_self_registration_enabled")
        throw new HTTPException(404, { message: "History not found" });
      const [row] = await db
        .select({ id: schema.instanceSettingTable.id })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "History not found" });
    } else if (type === "instance_job") {
      if (!registeredJobCatalog().some((job) => job.name === id))
        throw new HTTPException(404, { message: "History not found" });
      const [row] = await db
        .select({ name: instanceJobConfigurationTable.name })
        .from(instanceJobConfigurationTable)
        .where(eq(instanceJobConfigurationTable.name, id))
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "History not found" });
    } else if (type === "identity_connection") {
      const [row] = await db
        .select({ id: schema.identityConnectionTable.id })
        .from(schema.identityConnectionTable)
        .where(
          and(
            eq(schema.identityConnectionTable.id, id),
            isNull(schema.identityConnectionTable.deletedAt),
          ),
        )
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "History not found" });
    } else if (type === "import_source_connection") {
      const [row] = await db
        .select({ workspaceId: importSourceConnectionTable.workspaceId })
        .from(importSourceConnectionTable)
        .where(eq(importSourceConnectionTable.id, id))
        .limit(1);
      if (!row) throw new HTTPException(404, { message: "History not found" });
      workspaceId = row.workspaceId;
      requireWorkspaceHistoryReach(identity, workspaceId);
      if (!can(identity, "work_item:read", "workspace", { workspaceId }))
        throw new HTTPException(403, { message: "Forbidden" });
      c.set("workspaceId", workspaceId);
      c.set("workspaceIdSource", "row");
    }
    scope = { type, id, workspaceId, projectId: null, sessionId: session.id };
  } else if (
    type === "automation" ||
    type === "state" ||
    type === "time_activity" ||
    type === "cost_type" ||
    type === "hourly_rate" ||
    type === "budget"
  ) {
    if (identity.side !== "staff" || (type === "budget" && apiKey?.service))
      throw new HTTPException(403, { message: "Forbidden" });
    let target:
      | { workspaceId: string | null; projectId: string | null }
      | undefined;
    if (type === "automation") {
      const [row] = await db
        .select({
          workspaceId: automationTable.workspaceId,
          projectId: automationTable.projectId,
        })
        .from(automationTable)
        .where(eq(automationTable.id, id))
        .limit(1);
      target = row;
    } else if (type === "state") {
      const [row] = await db
        .select({ projectId: stateTable.projectId })
        .from(stateTable)
        .where(eq(stateTable.id, id))
        .limit(1);
      if (row) target = { workspaceId: null, projectId: row.projectId };
    } else if (type === "time_activity") {
      const [row] = await db
        .select({ workspaceId: timeActivityTable.workspaceId })
        .from(timeActivityTable)
        .where(eq(timeActivityTable.id, id))
        .limit(1);
      if (row) target = { workspaceId: row.workspaceId, projectId: null };
    } else if (type === "cost_type") {
      const [row] = await db
        .select({ workspaceId: costTypeTable.workspaceId })
        .from(costTypeTable)
        .where(eq(costTypeTable.id, id))
        .limit(1);
      if (row) target = { workspaceId: row.workspaceId, projectId: null };
    } else if (type === "hourly_rate") {
      const [row] = await db
        .select({
          workspaceId: hourlyRateTable.workspaceId,
          projectId: hourlyRateTable.projectId,
        })
        .from(hourlyRateTable)
        .where(eq(hourlyRateTable.id, id))
        .limit(1);
      target = row;
    } else {
      const [row] = await db
        .select({
          workspaceId: budgetTable.workspaceId,
          projectId: budgetTable.projectId,
        })
        .from(budgetTable)
        .where(eq(budgetTable.id, id))
        .limit(1);
      target = row;
    }
    if (!target) throw new HTTPException(404, { message: "History not found" });
    if (target.projectId !== null) {
      scope = await projectTargetScope(
        c,
        identity,
        type,
        id,
        target.projectId,
        target.workspaceId,
        type === "automation" || type === "state"
          ? "project:read"
          : type === "budget"
            ? "budget:read"
            : null,
      );
    } else {
      if (!target.workspaceId)
        throw new HTTPException(404, { message: "History not found" });
      requireWorkspaceHistoryReach(identity, target.workspaceId);
      c.set("workspaceId", target.workspaceId);
      c.set("workspaceIdSource", "row");
      scope = { type, id, workspaceId: target.workspaceId, projectId: null };
    }
    if (type === "automation" && scope.projectId === null) {
      if (
        !can(identity, "workspace:manage_settings", "workspace", {
          workspaceId: scope.workspaceId as string,
        })
      )
        throw new HTTPException(403, { message: "Forbidden" });
    } else if (
      type === "time_activity" ||
      type === "cost_type" ||
      type === "hourly_rate"
    ) {
      const capability =
        type === "time_activity"
          ? "time_entry:create"
          : "time_entry:manage_rates";
      if (
        !can(identity, capability, "workspace", {
          workspaceId: scope.workspaceId as string,
        })
      )
        throw new HTTPException(403, { message: "Forbidden" });
    }
    if (type === "time_activity") {
      if (
        !(await trackingFeatureReachable(
          TIME_TRACKING_FEATURE_KEY,
          scope.workspaceId as string,
        ))
      )
        throw new HTTPException(409, { message: "feature_disabled" });
    } else if (
      type === "cost_type" ||
      type === "hourly_rate" ||
      type === "budget"
    ) {
      const workspaceId = scope.workspaceId as string;
      if (
        !(await trackingFeatureEnabled(
          TIME_TRACKING_FEATURE_KEY,
          workspaceId,
        )) ||
        !(await trackingFeatureEnabled(
          COST_TRACKING_FEATURE_KEY,
          workspaceId,
        )) ||
        (type === "budget" &&
          (!(await trackingFeatureEnabled(
            TIME_TRACKING_FEATURE_KEY,
            workspaceId,
            scope.projectId,
          )) ||
            !(await trackingFeatureEnabled(
              COST_TRACKING_FEATURE_KEY,
              workspaceId,
              scope.projectId,
            ))))
      )
        throw new HTTPException(409, { message: "feature_disabled" });
    }
  } else if (type === "workspace_member") {
    const [row] = await db
      .select({
        workspaceId: schema.workspaceUserTable.workspaceId,
        userId: schema.workspaceUserTable.userId,
      })
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "History not found" });
    requireWorkspaceHistoryReach(identity, row.workspaceId);
    if (
      !can(identity, "workspace:read", "workspace", {
        workspaceId: row.workspaceId,
      })
    )
      throw new HTTPException(403, { message: "Forbidden" });
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    scope = {
      type,
      id,
      workspaceId: row.workspaceId,
      projectId: null,
      auditEntityId: row.userId,
    };
  } else if (type === "project_membership") {
    const [row] = await db
      .select({
        personId: schema.membershipTable.personId,
        projectId: schema.membershipTable.scopeId,
      })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.id, id),
          eq(schema.membershipTable.scope, "project"),
          exists(
            db
              .select({ one: sql`1` })
              .from(schema.membershipGrantTable)
              .where(
                and(
                  eq(
                    schema.membershipGrantTable.membershipId,
                    schema.membershipTable.id,
                  ),
                  eq(
                    schema.membershipGrantTable.personId,
                    schema.membershipTable.personId,
                  ),
                  eq(schema.membershipGrantTable.scope, "project"),
                  eq(
                    schema.membershipGrantTable.scopeId,
                    schema.membershipTable.scopeId,
                  ),
                  eq(
                    schema.membershipGrantTable.roleId,
                    schema.membershipTable.roleId,
                  ),
                  eq(schema.membershipGrantTable.sourceKind, "direct"),
                  isNull(schema.membershipGrantTable.revokedAt),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "History not found" });
    scope = {
      ...(await projectTargetScope(
        c,
        identity,
        type,
        id,
        row.projectId,
        null,
        "project:read",
      )),
      auditEntityId: row.personId,
    };
  } else if (type !== "project" && type !== "project_label") {
    const [row] =
      type === "workspace"
        ? await db
            .select({ workspaceId: schema.workspaceTable.id })
            .from(schema.workspaceTable)
            .where(eq(schema.workspaceTable.id, id))
            .limit(1)
        : type === "canned_response"
          ? await db
              .select({ workspaceId: cannedResponseTable.workspaceId })
              .from(cannedResponseTable)
              .where(eq(cannedResponseTable.id, id))
              .limit(1)
          : type === "workspace_label"
            ? await db
                .select({ workspaceId: labelTable.workspaceId })
                .from(labelTable)
                .where(
                  and(
                    eq(labelTable.id, id),
                    isNull(labelTable.projectId),
                    isNull(labelTable.taskId),
                  ),
                )
                .limit(1)
            : type === "role"
              ? await db
                  .select({ workspaceId: schema.roleTable.workspaceId })
                  .from(schema.roleTable)
                  .where(
                    and(
                      eq(schema.roleTable.id, id),
                      eq(schema.roleTable.scope, "workspace"),
                    ),
                  )
                  .limit(1)
              : type === "workflow"
                ? await db
                    .select({ workspaceId: schema.workflowTable.workspaceId })
                    .from(schema.workflowTable)
                    .where(eq(schema.workflowTable.id, id))
                    .limit(1)
                : type === "team"
                  ? await db
                      .select({ workspaceId: schema.teamTable.workspaceId })
                      .from(schema.teamTable)
                      .where(eq(schema.teamTable.id, id))
                      .limit(1)
                  : type === "service_calendar"
                    ? await db
                        .select({
                          workspaceId: schema.serviceCalendarTable.workspaceId,
                        })
                        .from(schema.serviceCalendarTable)
                        .where(eq(schema.serviceCalendarTable.id, id))
                        .limit(1)
                    : type === "sla_policy"
                      ? await db
                          .select({
                            workspaceId: schema.slaPolicyTable.workspaceId,
                          })
                          .from(schema.slaPolicyTable)
                          .where(eq(schema.slaPolicyTable.id, id))
                          .limit(1)
                      : type === "request_type"
                        ? await db
                            .select({
                              workspaceId: schema.requestTypeTable.workspaceId,
                            })
                            .from(schema.requestTypeTable)
                            .where(eq(schema.requestTypeTable.id, id))
                            .limit(1)
                        : type === "custom_field"
                          ? await db
                              .select({
                                workspaceId: customFieldTable.workspaceId,
                              })
                              .from(customFieldTable)
                              .where(eq(customFieldTable.id, id))
                              .limit(1)
                          : type === "custom_field_section"
                            ? await db
                                .select({
                                  workspaceId:
                                    customFieldSectionTable.workspaceId,
                                })
                                .from(customFieldSectionTable)
                                .where(eq(customFieldSectionTable.id, id))
                                .limit(1)
                            : type === "state_template"
                              ? await db
                                  .select({
                                    workspaceId:
                                      schema.stateTemplateTable.workspaceId,
                                  })
                                  .from(schema.stateTemplateTable)
                                  .where(eq(schema.stateTemplateTable.id, id))
                                  .limit(1)
                              : await db
                                  .select({
                                    workspaceId: webhookTable.workspaceId,
                                  })
                                  .from(webhookTable)
                                  .where(eq(webhookTable.id, id))
                                  .limit(1);
    const workspaceId = row?.workspaceId;
    if (!workspaceId)
      throw new HTTPException(404, { message: "History not found" });
    requireWorkspaceHistoryReach(identity, workspaceId);
    if (
      !can(
        identity,
        type === "workspace"
          ? "workspace:manage_settings"
          : type === "canned_response"
            ? "workspace:manage_settings"
            : type === "workspace_label"
              ? "workspace:read"
              : type === "state_template"
                ? "workspace:manage_settings"
                : type === "webhook"
                  ? "webhook:manage"
                  : type === "role" ||
                      type === "team" ||
                      type === "custom_field" ||
                      type === "custom_field_section"
                    ? "workspace:read"
                    : type === "workflow"
                      ? "workflow:read"
                      : type === "request_type"
                        ? "request_type:read"
                        : "sla_policy:read",
        "workspace",
        {
          workspaceId,
        },
      )
    )
      throw new HTTPException(403, { message: "Forbidden" });
    c.set("workspaceId", workspaceId);
    c.set("workspaceIdSource", "row");
    scope = { type, id, workspaceId };
  } else {
    const labelProject =
      type === "project_label"
        ? await db
            .select({ projectId: labelTable.projectId })
            .from(labelTable)
            .where(and(eq(labelTable.id, id), isNull(labelTable.taskId)))
            .limit(1)
        : null;
    const projectId =
      type === "project_label" ? labelProject?.[0]?.projectId : id;
    if (!projectId)
      throw new HTTPException(404, { message: "History not found" });
    const [row] = await db
      .select({
        id: schema.projectTable.id,
        workspaceId: schema.projectTable.workspaceId,
        organisationId: schema.workspaceTable.organisationId,
      })
      .from(schema.projectTable)
      .innerJoin(
        schema.workspaceTable,
        eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
      )
      .where(
        and(
          eq(schema.projectTable.id, projectId),
          isNull(schema.projectTable.deletedAt),
          type === "project_label"
            ? isNull(schema.projectTable.archivedAt)
            : undefined,
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "History not found" });
    const ancestorProjectIds = await loadProjectAncestorIdsFor(
      c,
      db,
      identity,
      row.workspaceId,
      row.id,
    );
    const ownerTeamId = await loadProjectOwnerTeamIdFor(
      db,
      identity,
      row.workspaceId,
      row.id,
    );
    const facts = {
      projectId: row.id,
      workspaceId: row.workspaceId,
      organisationId: row.organisationId,
      ancestorProjectIds,
      ownerTeamId,
    };
    if (!reaches(identity, facts))
      throw new HTTPException(404, { message: "History not found" });
    if (
      !can(
        identity,
        type === "project_label" ? "workspace:read" : "project:manage_settings",
        "project",
        {
          projectId: row.id,
          workspaceId: row.workspaceId,
          ancestorProjectIds,
        },
      )
    )
      throw new HTTPException(403, { message: "Forbidden" });
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("projectId", row.id);
    c.set("projectReachFacts", facts);
    c.set("policyScopeResource", "project");
    scope = { type, id, workspaceId: row.workspaceId, projectId: row.id };
  }
  c.set("settingsHistoryScope", scope);
  c.set("settingsHistoryIdentity", identity);
  setShadowLegacyAuthorization(c, "allowed");
  await next();
}

export async function readSettingsHistory(c: Context) {
  const scope = c.get("settingsHistoryScope") as HistoryScope | undefined;
  const identity = c.get("settingsHistoryIdentity") as
    | ResolvedIdentity
    | undefined;
  if (!scope || !identity)
    throw new HTTPException(500, { message: "History scope unavailable" });
  const query = {
    identity,
    entityType: scope.type,
    entityId: scope.id,
    auditEntityId: scope.auditEntityId,
    sessionId: scope.sessionId,
    apiKeyId: scope.apiKeyId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  };
  const rows = await listSettingsHistoryRows(query);
  const names = await listSettingsHistoryActorNames(
    query,
    rows.flatMap((row) =>
      row.actorType === "person" && row.actorId ? [row.actorId] : [],
    ),
  );
  await writeAuditRead(c, { workspaceId: scope.workspaceId });
  return {
    entityType: scope.type,
    entityId: scope.id,
    rows: rows.map((row) =>
      entityHistoryRow(
        row,
        row.actorId ? (names.get(row.actorId) ?? null) : null,
        scope.type,
      ),
    ),
  };
}

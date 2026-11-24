import type { JsonValue } from "@taskdesk/domain";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  customFieldSectionTable,
  customFieldTable,
} from "../database/migration-schema";
import {
  currentInstanceAdminPredicate,
  currentProjectReachPredicate,
  currentProjectReadPredicate,
  currentWorkspaceApiKeyManagePredicate,
  currentWorkspaceManageSettingsPredicate,
  currentWorkspaceReachPredicate,
  currentWorkspaceWorkItemReadPredicate,
} from "../database/repositories/identity-scope.repository";
import {
  apiKeyExtensionTable,
  apikeyTable,
  auditLogTable,
  automationTable,
  cannedResponseTable,
  identityConnectionTable,
  instanceFeatureFlagTable,
  instancePluginConfigTable,
  instanceSettingTable,
  labelTable,
  membershipGrantTable,
  membershipTable,
  projectFeatureFlagTable,
  projectTable,
  requestTypeTable,
  roleTable,
  serviceCalendarTable,
  sessionTable,
  slaPolicyTable,
  stateTable,
  stateTemplateTable,
  teamTable,
  userTable,
  webhookTable,
  workflowTable,
  workspaceFeatureFlagTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { importSourceConnectionTable } from "../database/schema-imports";
import { instanceJobConfigurationTable } from "../database/schema-instance-jobs";
import {
  budgetTable,
  costTypeTable,
  hourlyRateTable,
  timeActivityTable,
} from "../database/schema-p5-time";
import { EMAIL_PLUGIN_ID } from "../notification-provider/repository";
import { registeredJobCatalog } from "../scheduler";
import {
  S3_DRAFT_INSTANCE_KEY,
  S3_DRAFT_PLUGIN_ID,
} from "../storage/s3-draft-repository";
import { dbNowUtc } from "../utils/db-time";
import { HISTORY_ACTIONS, INSTANCE_PLUGIN_TARGETS } from "./history-actions";
import { AUDIT_CHAIN_LOCK_KEY } from "./lock";
import type { SettingsHistoryEntityType } from "./schema";
import { validTerminologyHistoryCell } from "./schema";

/**
 * Query ownership for the audit log (issue #580): actor-facing list reads scope from
 * resolved identity in SQL; chain verification remains a global AU-15 integrity scan.
 * Every function awaits and returns plain rows. The append path's
 * statements all run on the writer's single transaction handle in the same order
 * (lock, head read, clock read, insert), and the transaction boundary stays in
 * `audit-writer.ts`.
 */

export type AuditQuery = {
  readonly limit: number;
  readonly action?: string | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
};

type AuditListRow = Omit<
  typeof auditLogTable.$inferSelect,
  "before" | "after"
> & {
  before: JsonValue | null;
  after: JsonValue | null;
};

/**
 * Drizzle leaves JSONB columns as `unknown`. These fields are materialized by the
 * configured node-postgres/Drizzle JSONB path: PostgreSQL stores JSON values, pg-types
 * decodes JSONB with `JSON.parse`, and Drizzle returns the decoded value unchanged.
 * Keep the persisted value and row shape intact while exposing the existing JsonValue
 * contract to repository callers.
 */
function materializeAuditRows(
  rows: (typeof auditLogTable.$inferSelect)[],
): AuditListRow[] {
  return rows.map((row) => ({
    ...row,
    before: row.before as JsonValue | null,
    after: row.after as JsonValue | null,
  }));
}

/**
 * Shared WHERE construction for both audit list routes. The `action` filter is a
 * dotted-key PREFIX match (`auth.` selects the whole auth-lifecycle group). `%`, `_`
 * and backslash in the caller's prefix are backslash-escaped; PostgreSQL's LIKE treats
 * backslash as its default escape character, so a crafted prefix cannot become a
 * wildcard scan of every action.
 */
function auditListFilters(query: AuditQuery): (SQL | undefined)[] {
  const actionFilter =
    query.action === undefined
      ? undefined
      : like(
          auditLogTable.action,
          `${query.action.replace(/[\\%_]/g, (m) => `\\${m}`)}%`,
        );
  return [
    actionFilter,
    query.since === undefined
      ? undefined
      : gte(auditLogTable.createdAt, new Date(query.since)),
    query.until === undefined
      ? undefined
      : lt(auditLogTable.createdAt, new Date(query.until)),
    query.entityType === undefined
      ? undefined
      : eq(auditLogTable.entityType, query.entityType),
    query.entityId === undefined
      ? undefined
      : eq(auditLogTable.entityId, query.entityId),
  ];
}

function combineFilters(filters: (SQL | undefined)[]): SQL | undefined {
  const defined = filters.filter((f): f is SQL => f !== undefined);
  return defined.length === 0 ? undefined : and(...defined);
}

/** Every audit row matching the filters, newest first (instance administrators). */
export async function listInstanceAuditRows(
  identity: ResolvedIdentity,
  query: AuditQuery,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  // AU-11 is explicitly instance-wide for instance administrators. The route separately
  // enforces `instance:read_audit` (including a key's stored scope); this SQL predicate
  // revalidates the current persisted administrator relation without requiring the key's
  // narrowed capability subset to contain `instance:admin`.
  const rows = await tx
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        currentInstanceAdminPredicate(identity, tx),
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);
  return materializeAuditRows(rows);
}

/**
 * One workspace's audit rows, newest first. The workspace filter is unconditional; the
 * project filter is `project_id IS NULL`, plus `project_id IN (ids)` when the caller
 * reaches any project, or no project constraint for `"all"`.
 */
export async function listWorkspaceAuditRows(
  identity: ResolvedIdentity,
  workspaceId: string,
  query: AuditQuery,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  const auditProject = alias(projectTable, "audit_scope_project");
  const anyReachableProject = exists(
    tx
      .select({ one: sql`1` })
      .from(auditProject)
      .where(
        and(
          eq(auditProject.id, auditLogTable.projectId),
          eq(auditProject.workspaceId, workspaceId),
          currentProjectReachPredicate(
            identity,
            auditProject.id,
            auditProject.workspaceId,
            auditProject.organisationId,
            tx,
          ),
        ),
      ),
  );
  const rowReach =
    identity.side === "staff"
      ? or(isNull(auditLogTable.projectId), anyReachableProject)
      : sql`false`;
  const rows = await tx
    .select()
    .from(auditLogTable)
    .where(
      combineFilters([
        eq(auditLogTable.workspaceId, workspaceId),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workspaceTable)
            .where(
              and(
                eq(workspaceTable.id, workspaceId),
                currentWorkspaceReachPredicate(identity, workspaceTable.id, tx),
              ),
            ),
        ),
        rowReach,
        ...auditListFilters(query),
      ]),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(query.limit);
  return materializeAuditRows(rows);
}

/** An exact persisted settings entity, fenced by the scoped row loaded by the caller. */
export type SettingsHistoryInput = {
  identity: ResolvedIdentity;
  entityType: SettingsHistoryEntityType;
  entityId: string;
  auditEntityId?: string;
  sessionId?: string;
  apiKeyId?: string;
  workspaceId: string | null;
  projectId?: string | null;
};

const workspaceHistoryTargets = {
  role: roleTable,
  workflow: workflowTable,
  team: teamTable,
  service_calendar: serviceCalendarTable,
  sla_policy: slaPolicyTable,
  request_type: requestTypeTable,
  custom_field: customFieldTable,
  custom_field_section: customFieldSectionTable,
  state_template: stateTemplateTable,
  webhook: webhookTable,
  canned_response: cannedResponseTable,
  time_activity: timeActivityTable,
  cost_type: costTypeTable,
} as const;

const estimateFeatureEnabled = (projectId: string, workspaceId: string) => sql`
  coalesce(
    (select ${instanceFeatureFlagTable.enabled} from ${instanceFeatureFlagTable}
     where ${instanceFeatureFlagTable.featureKey} = 'feature.estimates'
       and ${instanceFeatureFlagTable.locked} = true),
    (select ${projectFeatureFlagTable.enabled} from ${projectFeatureFlagTable}
     where ${projectFeatureFlagTable.projectId} = ${projectId}
       and ${projectFeatureFlagTable.featureKey} = 'feature.estimates'),
    (select ${workspaceFeatureFlagTable.enabled} from ${workspaceFeatureFlagTable}
     where ${workspaceFeatureFlagTable.workspaceId} = ${workspaceId}
       and ${workspaceFeatureFlagTable.featureKey} = 'feature.estimates'),
    (select ${instanceFeatureFlagTable.enabled} from ${instanceFeatureFlagTable}
     where ${instanceFeatureFlagTable.featureKey} = 'feature.estimates'),
    false
  ) = true`;

function currentP4Credential(input: SettingsHistoryInput, tx: Executor) {
  if (input.identity.credential === "session") return sql`true`;
  if (
    !input.apiKeyId ||
    !["api_key", "mcp_key"].includes(input.identity.credential)
  )
    return sql`false`;
  const service = input.identity.userId.startsWith("service-key:");
  if (service && input.identity.userId !== `service-key:${input.apiKeyId}`)
    return sql`false`;
  return exists(
    tx
      .select({ one: sql`1` })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, input.apiKeyId),
          eq(apikeyTable.enabled, true),
          or(
            isNull(apikeyTable.expiresAt),
            sql`${apikeyTable.expiresAt} > ${dbNowUtc()}`,
          ),
          service ? undefined : eq(apikeyTable.userId, input.identity.userId),
        ),
      ),
  );
}

function settingsHistoryCurrentReach(
  input: SettingsHistoryInput,
  tx: Executor,
) {
  if (input.entityType === "service_api_key") {
    if (
      input.identity.credential !== "session" ||
      input.identity.side !== "staff" ||
      !input.sessionId ||
      !input.workspaceId ||
      input.projectId !== null ||
      input.auditEntityId
    )
      return sql`false`;
    return and(
      exists(
        tx
          .select({ one: sql`1` })
          .from(sessionTable)
          .where(
            and(
              eq(sessionTable.id, input.sessionId),
              eq(sessionTable.userId, input.identity.userId),
              eq(sessionTable.portal, "agent"),
              isNull(sessionTable.impersonatedBy),
              sql`${sessionTable.expiresAt} > ${dbNowUtc()}`,
            ),
          ),
      ),
      exists(
        tx
          .select({ one: sql`1` })
          .from(apikeyTable)
          .innerJoin(
            apiKeyExtensionTable,
            eq(apiKeyExtensionTable.apikeyId, apikeyTable.id),
          )
          .where(
            and(
              eq(apikeyTable.id, input.entityId),
              eq(apiKeyExtensionTable.workspaceId, input.workspaceId),
              isNull(apiKeyExtensionTable.personId),
              eq(apiKeyExtensionTable.isMcp, false),
            ),
          ),
      ),
      exists(
        tx
          .select({ one: sql`1` })
          .from(workspaceTable)
          .where(
            and(
              eq(workspaceTable.id, input.workspaceId),
              currentWorkspaceReachPredicate(
                input.identity,
                workspaceTable.id,
                tx,
              ),
              currentWorkspaceApiKeyManagePredicate(
                input.identity,
                workspaceTable.id,
                tx,
              ),
            ),
          ),
      ),
    );
  }
  if (input.entityType === "terminology_override") {
    if (
      input.projectId !== null ||
      !validTerminologyHistoryCell(input.entityId)
    )
      return sql`false`;
    if (input.workspaceId === null)
      return and(
        currentP4Credential(input, tx),
        currentInstanceAdminPredicate(input.identity, tx),
      );
    return exists(
      tx
        .select({ one: sql`1` })
        .from(workspaceTable)
        .where(
          and(
            eq(workspaceTable.id, input.workspaceId),
            currentWorkspaceReachPredicate(
              input.identity,
              workspaceTable.id,
              tx,
            ),
            currentWorkspaceManageSettingsPredicate(
              input.identity,
              workspaceTable.id,
              tx,
            ),
            currentP4Credential(input, tx),
          ),
        ),
    );
  }
  if (input.entityType === "instance")
    return and(
      exists(
        tx
          .select({ one: sql`1` })
          .from(instanceSettingTable)
          .where(eq(instanceSettingTable.id, input.entityId)),
      ),
      currentInstanceAdminPredicate(input.identity, tx),
    );

  if (INSTANCE_PLUGIN_TARGETS.has(input.entityType)) {
    if (
      input.identity.credential !== "session" ||
      input.identity.side !== "staff" ||
      !input.sessionId
    )
      return sql`false`;
    const admin = and(
      currentInstanceAdminPredicate(input.identity, tx),
      exists(
        tx
          .select({ one: sql`1` })
          .from(sessionTable)
          .where(
            and(
              eq(sessionTable.id, input.sessionId),
              eq(sessionTable.userId, input.identity.userId),
              eq(sessionTable.portal, "agent"),
              isNull(sessionTable.impersonatedBy),
              sql`${sessionTable.expiresAt} > ${dbNowUtc()}`,
            ),
          ),
      ),
    );
    if (input.entityType === "instance_auth_methods")
      return and(
        admin,
        input.entityId === "auth.local-methods" ? sql`true` : sql`false`,
      );
    if (input.entityType === "staff_self_registration")
      return and(
        admin,
        input.entityId === "staff_self_registration_enabled"
          ? sql`true`
          : sql`false`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(instanceSettingTable)
            .where(eq(instanceSettingTable.id, "singleton")),
        ),
      );
    if (input.entityType === "instance_job")
      return and(
        admin,
        registeredJobCatalog().some((job) => job.name === input.entityId)
          ? sql`true`
          : sql`false`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(instanceJobConfigurationTable)
            .where(eq(instanceJobConfigurationTable.name, input.entityId)),
        ),
      );
    if (input.entityType === "identity_connection")
      return and(
        admin,
        exists(
          tx
            .select({ one: sql`1` })
            .from(identityConnectionTable)
            .where(
              and(
                eq(identityConnectionTable.id, input.entityId),
                isNull(identityConnectionTable.deletedAt),
              ),
            ),
        ),
      );
    if (input.entityType === "import_source_connection") {
      if (!input.workspaceId) return sql`false`;
      return and(
        admin,
        exists(
          tx
            .select({ one: sql`1` })
            .from(importSourceConnectionTable)
            .where(
              and(
                eq(importSourceConnectionTable.id, input.entityId),
                eq(importSourceConnectionTable.workspaceId, input.workspaceId),
              ),
            ),
        ),
        exists(
          tx
            .select({ one: sql`1` })
            .from(workspaceTable)
            .where(
              and(
                eq(workspaceTable.id, input.workspaceId),
                currentWorkspaceReachPredicate(
                  input.identity,
                  workspaceTable.id,
                  tx,
                ),
                currentWorkspaceWorkItemReadPredicate(
                  input.identity,
                  workspaceTable.id,
                  tx,
                ),
              ),
            ),
        ),
      );
    }
    const pluginId =
      input.entityType === "instance_notification_provider"
        ? EMAIL_PLUGIN_ID
        : S3_DRAFT_PLUGIN_ID;
    const instanceKey =
      input.entityType === "instance_notification_provider"
        ? "default"
        : S3_DRAFT_INSTANCE_KEY;
    return and(
      admin,
      exists(
        tx
          .select({ one: sql`1` })
          .from(instancePluginConfigTable)
          .where(
            and(
              eq(instancePluginConfigTable.id, input.entityId),
              eq(instancePluginConfigTable.pluginId, pluginId),
              eq(instancePluginConfigTable.instanceKey, instanceKey),
              eq(instancePluginConfigTable.scope, "instance"),
              isNull(instancePluginConfigTable.workspaceId),
              isNull(instancePluginConfigTable.portalScope),
            ),
          ),
      ),
    );
  }

  if (input.workspaceId === null) return sql`false`;
  if (
    input.entityType === "project_estimates" &&
    input.projectId !== input.entityId
  )
    return sql`false`;
  if (
    input.entityType === "project" ||
    input.entityType === "project_features" ||
    input.entityType === "project_label" ||
    input.entityType === "state" ||
    input.entityType === "budget" ||
    input.entityType === "project_membership" ||
    input.entityType === "project_estimates" ||
    ((input.entityType === "automation" ||
      input.entityType === "hourly_rate") &&
      input.projectId != null)
  ) {
    if (
      input.entityType !== "project" &&
      input.entityType !== "project_label" &&
      !input.projectId
    )
      return sql`false`;
    const projectId = input.projectId ?? input.entityId;
    const liveProject = exists(
      tx
        .select({ one: sql`1` })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, projectId),
            eq(projectTable.workspaceId, input.workspaceId),
            isNull(projectTable.deletedAt),
            input.entityType === "project_label"
              ? isNull(projectTable.archivedAt)
              : undefined,
            currentProjectReachPredicate(
              input.identity,
              projectTable.id,
              projectTable.workspaceId,
              projectTable.organisationId,
              tx,
            ),
            input.entityType === "project_estimates"
              ? and(
                  currentP4Credential(input, tx),
                  currentProjectReadPredicate(
                    input.identity,
                    projectTable.id,
                    projectTable.workspaceId,
                    tx,
                  ),
                  estimateFeatureEnabled(input.entityId, input.workspaceId),
                )
              : undefined,
          ),
        ),
    );
    if (
      input.entityType === "project" ||
      input.entityType === "project_features" ||
      input.entityType === "project_estimates"
    )
      return liveProject;
    if (input.entityType === "project_membership")
      return and(
        liveProject,
        input.auditEntityId ? sql`true` : sql`false`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(membershipTable)
            .where(
              and(
                eq(membershipTable.id, input.entityId),
                eq(membershipTable.personId, input.auditEntityId ?? ""),
                eq(membershipTable.scope, "project"),
                eq(membershipTable.scopeId, projectId),
                exists(
                  tx
                    .select({ one: sql`1` })
                    .from(membershipGrantTable)
                    .where(
                      and(
                        eq(
                          membershipGrantTable.membershipId,
                          membershipTable.id,
                        ),
                        eq(
                          membershipGrantTable.personId,
                          membershipTable.personId,
                        ),
                        eq(membershipGrantTable.scope, "project"),
                        eq(
                          membershipGrantTable.scopeId,
                          membershipTable.scopeId,
                        ),
                        eq(membershipGrantTable.roleId, membershipTable.roleId),
                        eq(membershipGrantTable.sourceKind, "direct"),
                        isNull(membershipGrantTable.revokedAt),
                      ),
                    ),
                ),
              ),
            ),
        ),
      );
    if (input.entityType === "state")
      return and(
        liveProject,
        exists(
          tx
            .select({ one: sql`1` })
            .from(stateTable)
            .where(
              and(
                eq(stateTable.id, input.entityId),
                eq(stateTable.projectId, projectId),
              ),
            ),
        ),
      );
    if (input.entityType === "budget")
      return and(
        liveProject,
        exists(
          tx
            .select({ one: sql`1` })
            .from(budgetTable)
            .where(
              and(
                eq(budgetTable.id, input.entityId),
                eq(budgetTable.workspaceId, input.workspaceId),
                eq(budgetTable.projectId, projectId),
              ),
            ),
        ),
      );
    if (
      input.entityType === "automation" ||
      input.entityType === "hourly_rate"
    ) {
      const table =
        input.entityType === "automation" ? automationTable : hourlyRateTable;
      return and(
        liveProject,
        exists(
          tx
            .select({ one: sql`1` })
            .from(table)
            .where(
              and(
                eq(table.id, input.entityId),
                eq(table.workspaceId, input.workspaceId),
                eq(table.projectId, projectId),
              ),
            ),
        ),
      );
    }
    return and(
      liveProject,
      exists(
        tx
          .select({ one: sql`1` })
          .from(labelTable)
          .where(
            and(
              eq(labelTable.id, input.entityId),
              eq(labelTable.workspaceId, input.workspaceId),
              eq(labelTable.projectId, projectId),
              isNull(labelTable.taskId),
            ),
          ),
      ),
    );
  }

  const workspaceReach = exists(
    tx
      .select({ one: sql`1` })
      .from(workspaceTable)
      .where(
        and(
          eq(workspaceTable.id, input.workspaceId),
          currentWorkspaceReachPredicate(input.identity, workspaceTable.id, tx),
        ),
      ),
  );
  if (
    input.entityType === "workspace" ||
    input.entityType === "workspace_features"
  )
    return and(
      workspaceReach,
      input.entityId === input.workspaceId ? sql`true` : sql`false`,
    );
  if (input.entityType === "workspace_member")
    return and(
      workspaceReach,
      input.identity.credential === "session" && input.identity.side === "staff"
        ? sql`true`
        : sql`false`,
      input.auditEntityId ? sql`true` : sql`false`,
      exists(
        tx
          .select({ one: sql`1` })
          .from(workspaceUserTable)
          .where(
            and(
              eq(workspaceUserTable.id, input.entityId),
              eq(workspaceUserTable.workspaceId, input.workspaceId),
              eq(workspaceUserTable.userId, input.auditEntityId ?? ""),
            ),
          ),
      ),
    );
  if (input.entityType === "workspace_label")
    return and(
      workspaceReach,
      exists(
        tx
          .select({ one: sql`1` })
          .from(labelTable)
          .where(
            and(
              eq(labelTable.id, input.entityId),
              eq(labelTable.workspaceId, input.workspaceId),
              isNull(labelTable.projectId),
              isNull(labelTable.taskId),
            ),
          ),
      ),
    );
  if (input.entityType === "automation" || input.entityType === "hourly_rate") {
    const table =
      input.entityType === "automation" ? automationTable : hourlyRateTable;
    return and(
      workspaceReach,
      input.projectId === null ? sql`true` : sql`false`,
      exists(
        tx
          .select({ one: sql`1` })
          .from(table)
          .where(
            and(
              eq(table.id, input.entityId),
              eq(table.workspaceId, input.workspaceId),
              isNull(table.projectId),
            ),
          ),
      ),
    );
  }
  const table = Object.hasOwn(workspaceHistoryTargets, input.entityType)
    ? workspaceHistoryTargets[
        input.entityType as keyof typeof workspaceHistoryTargets
      ]
    : undefined;
  if (!table) return sql`false`;
  return and(
    workspaceReach,
    exists(
      tx
        .select({ one: sql`1` })
        .from(table)
        .where(
          and(
            eq(table.id, input.entityId),
            eq(table.workspaceId, input.workspaceId),
            input.entityType === "role"
              ? eq(roleTable.scope, "workspace")
              : undefined,
          ),
        ),
    ),
  );
}

function settingsHistoryFilter(input: SettingsHistoryInput, tx: Executor) {
  const instancePlugin = INSTANCE_PLUGIN_TARGETS.has(input.entityType);
  const projectBound =
    input.entityType === "project" ||
    input.entityType === "project_features" ||
    input.entityType === "project_label" ||
    input.entityType === "state" ||
    input.entityType === "budget" ||
    input.entityType === "project_membership" ||
    input.entityType === "project_estimates" ||
    ((input.entityType === "automation" ||
      input.entityType === "hourly_rate") &&
      input.projectId != null);
  return and(
    settingsHistoryCurrentReach(input, tx),
    // The table is the only action filter: observability, rekey and lifecycle rows never show.
    inArray(auditLogTable.action, [
      ...HISTORY_ACTIONS.entity[input.entityType],
    ]),
    input.entityType === "workspace_member" ||
      input.entityType === "project_membership"
      ? and(
          sql`jsonb_typeof(${auditLogTable.before} -> 'role') = 'string'`,
          sql`jsonb_typeof(${auditLogTable.after} -> 'role') = 'string'`,
          sql`(${auditLogTable.before} ->> 'role') is distinct from (${auditLogTable.after} ->> 'role')`,
          input.entityType === "workspace_member"
            ? and(
                sql`${auditLogTable.after} ->> 'kind' = 'member_role_changed'`,
                sql`${auditLogTable.after} ->> 'userId' = ${input.auditEntityId ?? ""}`,
              )
            : and(
                sql`${auditLogTable.after} ->> 'source' = 'project_roster'`,
                sql`${auditLogTable.after} ->> 'change' = 'role_changed'`,
                sql`${auditLogTable.after} ->> 'scope' = 'project'`,
                sql`${auditLogTable.after} ->> 'scopeId' = ${input.projectId ?? ""}`,
                sql`${auditLogTable.after} ->> 'granted' = 'true'`,
                sql`${auditLogTable.before} ->> 'scope' = 'project'`,
                sql`${auditLogTable.before} ->> 'scopeId' = ${input.projectId ?? ""}`,
              ),
        )
      : undefined,
    eq(
      auditLogTable.entityType,
      input.entityType === "role"
        ? "workspace_role"
        : input.entityType === "instance_notification_provider" ||
            input.entityType === "instance_storage_draft" ||
            input.entityType === "instance_auth_methods"
          ? "instance_plugin_config"
          : input.entityType === "staff_self_registration"
            ? "instance_setting"
            : input.entityType === "instance_job"
              ? "job"
              : input.entityType === "project_membership"
                ? "membership"
                : input.entityType === "service_api_key"
                  ? "api_key"
                  : input.entityType === "project_estimates"
                    ? "estimate"
                    : input.entityType === "workspace_label" ||
                        input.entityType === "project_label"
                      ? "label"
                      : input.entityType === "workspace_features"
                        ? "workspace"
                        : input.entityType === "project_features"
                          ? "project"
                          : input.entityType,
    ),
    input.entityType === "project_estimates"
      ? undefined
      : eq(auditLogTable.entityId, input.auditEntityId ?? input.entityId),
    input.entityType === "instance" ||
      (input.entityType === "terminology_override" &&
        input.workspaceId === null)
      ? and(isNull(auditLogTable.workspaceId), isNull(auditLogTable.projectId))
      : instancePlugin
        ? and(
            input.entityType === "import_source_connection"
              ? input.workspaceId
                ? eq(auditLogTable.workspaceId, input.workspaceId)
                : sql`false`
              : isNull(auditLogTable.workspaceId),
            isNull(auditLogTable.projectId),
          )
        : projectBound
          ? input.workspaceId === null
            ? sql`false`
            : and(
                eq(auditLogTable.projectId, input.projectId ?? input.entityId),
                eq(auditLogTable.workspaceId, input.workspaceId),
              )
          : input.workspaceId === null
            ? sql`false`
            : and(
                eq(auditLogTable.workspaceId, input.workspaceId),
                isNull(auditLogTable.projectId),
              ),
  );
}

export async function listSettingsHistoryRows(
  input: SettingsHistoryInput,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  const rows = await tx
    .select()
    .from(auditLogTable)
    .where(settingsHistoryFilter(input, tx))
    .orderBy(desc(auditLogTable.seq))
    .limit(200);
  return materializeAuditRows(rows);
}

/** Names only for actors present in the already authorized entity history. */
export async function listSettingsHistoryActorNames(
  input: SettingsHistoryInput,
  actorIds: readonly string[],
  executor?: Executor,
): Promise<Map<string, string>> {
  if (!actorIds.length) return new Map();
  const tx = executorOrDefault(executor);
  const rows = await tx
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(
      and(
        inArray(userTable.id, [...new Set(actorIds)]),
        exists(
          tx
            .select({ one: sql`1` })
            .from(auditLogTable)
            .where(
              and(
                settingsHistoryFilter(input, tx),
                eq(auditLogTable.actorId, userTable.id),
              ),
            ),
        ),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

export type AuditLogChainRow = {
  id: string;
  seq: string;
  actor_id: string | null;
  actor_type: string;
  api_key_id: string | null;
  impersonator_id: string | null;
  actor_ip: string | null;
  user_agent: string | null;
  trace_id: string | null;
  workspace_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: JsonValue | null;
  after: JsonValue | null;
  created_at_iso: string;
  prev_hash: string;
  row_hash: string;
};

/** Every row's hash inputs in `seq` order, `created_at` as the exact UTC ISO string. */
export async function listAuditChainRows(executor: Executor) {
  const result = await executor.execute<AuditLogChainRow>(
    sql`
      SELECT
        id, seq, actor_id, actor_type, api_key_id, impersonator_id, actor_ip,
        user_agent, trace_id, workspace_id, action, entity_type, entity_id,
        before, after,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
        prev_hash, row_hash
      FROM audit_log
      ORDER BY seq ASC
    `,
  );
  return result.rows;
}

/** Step 1 of an append: serialise on the single global chain lock until commit. */
export async function lockAuditChain(tx: Executor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
}

/** Step 2: the current head's `row_hash`, or `undefined` for an empty log. */
export async function readAuditChainHeadHash(
  tx: Executor,
): Promise<string | undefined> {
  const headResult = await tx.execute<{ row_hash: string }>(
    sql`SELECT row_hash FROM audit_log ORDER BY seq DESC LIMIT 1`,
  );
  return headResult.rows[0]?.row_hash;
}

/** Step 3: one `now()` read in the hashable ISO form and the insertable text form. */
export async function readDatabaseNow(tx: Executor) {
  const nowResult = await tx.execute<{ now_iso: string; now_text: string }>(
    sql`SELECT
        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now_iso,
        now()::text AS now_text`,
  );
  return nowResult.rows[0];
}

export type AuditRowInsert = {
  id: string;
  actorId: string | null;
  actorType: string;
  apiKeyId: string | null;
  impersonatorId: string | null;
  actorIp: string | null;
  userAgent: string | null;
  traceId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** `JSON.stringify` text or `null`; bound as text and cast to `jsonb`. */
  beforeJson: string | null;
  afterJson: string | null;
  /** The clock text read by `readDatabaseNow`, inserted as `timestamptz`. */
  createdAtText: string;
  prevHash: string;
  rowHash: string;
};

/** Step 5: the insert; returns the new row's id and seq. */
export async function insertAuditRow(tx: Executor, row: AuditRowInsert) {
  const insertResult = await tx.execute<{
    id: string;
    seq: string;
  }>(
    sql`
        INSERT INTO audit_log (
          id, actor_id, actor_type, api_key_id, impersonator_id, actor_ip, user_agent,
          trace_id, workspace_id, project_id, organisation_id, action, entity_type,
          entity_id, before, after, created_at, prev_hash, row_hash
        ) VALUES (
          ${row.id}, ${row.actorId}, ${row.actorType}, ${row.apiKeyId},
          ${row.impersonatorId}, ${row.actorIp},
          ${row.userAgent}, ${row.traceId},
          ${row.workspaceId}, ${row.projectId},
          ${row.organisationId},
          ${row.action}, ${row.entityType}, ${row.entityId},
          ${row.beforeJson}::jsonb, ${row.afterJson}::jsonb,
          ${row.createdAtText}::timestamptz, ${row.prevHash}, ${row.rowHash}
        )
        RETURNING id, seq
      `,
  );
  return insertResult.rows[0];
}

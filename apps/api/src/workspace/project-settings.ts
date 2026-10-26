import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema } from "../database";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { withWorkspaceDeletionAccessLifecycle } from "../pending-action/workspace-access-invalidation";
import { isUniqueViolation } from "../utils/is-unique-violation";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createWorkspaceStateTemplateBodySchema,
  stateSetConflictSchema,
  updateWorkspaceProjectSettingsBodySchema,
  updateWorkspaceStateTemplateBodySchema,
  workspaceProjectSettingsSchema,
  workspaceStateTemplateListSchema,
  workspaceStateTemplateSchema,
} from "./project-settings-schema";

const workspaceParam = z.object({ workspaceId: z.string().min(1).max(128) });
const stateTemplateParam = workspaceParam.extend({
  stateTemplateId: z.string().min(1).max(128),
});
const workspaceVersionConflictSchema = z.object({
  message: z.literal("workspace_project_settings_conflict"),
  currentVersion: z.number().int().positive(),
});
const createStateTemplateConflictSchema = z.union([
  workspaceVersionConflictSchema,
  z.object({ message: z.literal("state_template_key_taken") }).strict(),
]);
const updateStateTemplateConflictSchema = z.union([
  workspaceVersionConflictSchema,
  stateSetConflictSchema,
  z.object({ message: z.literal("workspace_requires_enabled_state") }).strict(),
]);

type AuditActor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};
type SettingsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class WorkspaceSettingsVersionConflict extends Error {
  constructor(readonly currentVersion: number) {
    super("workspace_project_settings_conflict");
  }
}

class WorkspaceStateInUse extends Error {
  constructor(readonly payload: z.infer<typeof stateSetConflictSchema>) {
    super("state_in_use");
  }
}

function auditActor(c: Context): AuditActor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    actorId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

async function appendSettingsAudit(
  tx: SettingsTransaction,
  input: {
    actor: AuditActor;
    workspaceId: string;
    action: string;
    entityType: string;
    entityId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  },
): Promise<boolean> {
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        apiKeyId: input.actor.apiKeyId,
        workspaceId: input.workspaceId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as never,
        after: input.after as never,
      }),
    );
    return false;
  } catch {
    recordAuditWriteFailure("mutation");
    return true;
  }
}

async function currentWorkspaceSettings(
  tx: SettingsTransaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({
      id: schema.workspaceTable.id,
      defaultSlaPolicyId: schema.workspaceTable.defaultSlaPolicyId,
      defaultServiceCalendarId: schema.workspaceTable.defaultServiceCalendarId,
      projectSettingsVersion: schema.workspaceTable.projectSettingsVersion,
    })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("update")
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Workspace not found" });
  return workspace;
}

async function listEnabledStateTemplateIds(
  tx: SettingsTransaction,
  workspaceId: string,
) {
  const templates = await tx
    .select({ id: schema.stateTemplateTable.id })
    .from(schema.stateTemplateTable)
    .where(
      and(
        eq(schema.stateTemplateTable.workspaceId, workspaceId),
        isNull(schema.stateTemplateTable.archivedAt),
      ),
    )
    .orderBy(
      asc(schema.stateTemplateTable.key),
      asc(schema.stateTemplateTable.id),
    );
  return templates.map((row) => row.id);
}

async function readProjectSettings(
  tx: SettingsTransaction,
  workspaceId: string,
) {
  const [workspace] = await tx
    .select({
      id: schema.workspaceTable.id,
      defaultSlaPolicyId: schema.workspaceTable.defaultSlaPolicyId,
      defaultServiceCalendarId: schema.workspaceTable.defaultServiceCalendarId,
      projectSettingsVersion: schema.workspaceTable.projectSettingsVersion,
    })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId))
    .for("share")
    .limit(1);
  if (!workspace)
    throw new HTTPException(404, { message: "Workspace not found" });
  return workspaceProjectSettingsSchema.parse({
    workspaceId: workspace.id,
    defaultSlaPolicyId: workspace.defaultSlaPolicyId,
    defaultServiceCalendarId: workspace.defaultServiceCalendarId,
    enabledStateTemplateIds: await listEnabledStateTemplateIds(tx, workspaceId),
    version: workspace.projectSettingsVersion,
  });
}

const getProjectSettingsRoute = createRoute({
  method: "get",
  path: "/{workspaceId}/project-settings",
  operationId: "getWorkspaceProjectSettings",
  tags: ["Workspace settings"],
  summary: "Get project defaults and the enabled workspace state set",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireSessionOnly(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: workspaceParam },
  responses: {
    200: jsonResponse(
      "Workspace project settings",
      workspaceProjectSettingsSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings capability"),
    404: errorResponse("Workspace not found"),
  },
});

const updateProjectSettingsRoute = createRoute({
  method: "patch",
  path: "/{workspaceId}/project-settings",
  operationId: "updateWorkspaceProjectSettings",
  tags: ["Workspace settings"],
  summary: "Update workspace defaults for new and inheriting projects",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireSessionOnly(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: workspaceParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateWorkspaceProjectSettingsBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated workspace project settings",
      workspaceProjectSettingsSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings capability"),
    404: errorResponse("Workspace or referenced setting not found"),
    409: jsonResponse(
      "Workspace settings changed since they were loaded",
      workspaceVersionConflictSchema,
    ),
    422: errorResponse(
      "Referenced SLA policy or service calendar is unavailable",
    ),
  },
});

const listStateTemplatesRoute = createRoute({
  method: "get",
  path: "/{workspaceId}/state-templates",
  operationId: "listWorkspaceStateTemplates",
  tags: ["Workspace states"],
  summary: "List the workspace state templates",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireSessionOnly(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: { params: workspaceParam },
  responses: {
    200: jsonResponse(
      "Workspace state templates",
      workspaceStateTemplateListSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings capability"),
    404: errorResponse("Workspace not found"),
  },
});

const createStateTemplateRoute = createRoute({
  method: "post",
  path: "/{workspaceId}/state-templates",
  operationId: "createWorkspaceStateTemplate",
  tags: ["Workspace states"],
  summary: "Create a workspace state template",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireSessionOnly(),
    requireWorkspaceCapability("workspace:manage_settings"),
  ] as const,
  request: {
    params: workspaceParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createWorkspaceStateTemplateBodySchema,
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      "Created workspace state template",
      workspaceStateTemplateSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings capability"),
    404: errorResponse("Workspace not found"),
    409: jsonResponse(
      "Workspace settings changed or state key already exists",
      createStateTemplateConflictSchema,
    ),
  },
});

const updateStateTemplateRoute = createRoute({
  method: "patch",
  path: "/{workspaceId}/state-templates/{stateTemplateId}",
  operationId: "updateWorkspaceStateTemplate",
  tags: ["Workspace states"],
  summary: "Update or enable a workspace state template",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireSessionOnly(),
    requireWorkspaceCapability("workspace:manage_settings"),
    requireReachFilteredList,
  ] as const,
  request: {
    params: stateTemplateParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateWorkspaceStateTemplateBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated workspace state template",
      workspaceStateTemplateSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings capability"),
    404: errorResponse("Workspace or state template not found"),
    409: jsonResponse(
      "Workspace settings changed, the last state cannot be disabled, or a state is still in use",
      updateStateTemplateConflictSchema,
    ),
  },
});

export const workspaceProjectSettingsApi = apiRouter()
  .openapi(getProjectSettingsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const result = await db.transaction((tx) =>
      readProjectSettings(tx, workspaceId),
    );
    c.header("Cache-Control", "no-store");
    return c.json(result, 200);
  })
  .openapi(updateProjectSettingsRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = auditActor(c);
    let auditFailed = false;
    let result: z.infer<typeof workspaceProjectSettingsSchema>;
    try {
      result = await withWorkspaceDeletionAccessLifecycle(
        workspaceId,
        async (tx) => {
          const current = await currentWorkspaceSettings(tx, workspaceId);
          if (current.projectSettingsVersion !== body.expectedVersion)
            throw new WorkspaceSettingsVersionConflict(
              current.projectSettingsVersion,
            );
          if (body.defaultSlaPolicyId) {
            const [policy] = await tx
              .select({
                id: schema.slaPolicyTable.id,
                activeVersionId: schema.slaPolicyTable.activeVersionId,
              })
              .from(schema.slaPolicyTable)
              .where(
                and(
                  eq(schema.slaPolicyTable.id, body.defaultSlaPolicyId),
                  eq(schema.slaPolicyTable.workspaceId, workspaceId),
                ),
              )
              .limit(1);
            if (!policy?.activeVersionId)
              throw new HTTPException(422, {
                message: "SLA policy is unavailable",
              });
          }
          if (body.defaultServiceCalendarId) {
            const [calendar] = await tx
              .select({ id: schema.serviceCalendarTable.id })
              .from(schema.serviceCalendarTable)
              .where(
                and(
                  eq(
                    schema.serviceCalendarTable.id,
                    body.defaultServiceCalendarId,
                  ),
                  eq(schema.serviceCalendarTable.workspaceId, workspaceId),
                ),
              )
              .limit(1);
            if (!calendar)
              throw new HTTPException(422, {
                message: "Service calendar is unavailable",
              });
          }
          if (body.defaultServiceCalendarId === null) {
            const [dependentManagedProject] = await tx
              .select({ id: schema.projectTable.id })
              .from(schema.projectTable)
              .where(
                and(
                  eq(schema.projectTable.workspaceId, workspaceId),
                  eq(schema.projectTable.kind, "managed_service"),
                  eq(schema.projectTable.serviceCalendarMode, "inherit"),
                  isNull(schema.projectTable.deletedAt),
                ),
              )
              .limit(1);
            if (dependentManagedProject)
              throw new HTTPException(422, {
                message: "workspace_calendar_required_by_managed_service",
              });
          }
          const changedFields = [
            ...(body.defaultSlaPolicyId !== undefined
              ? ["defaultSlaPolicyId"]
              : []),
            ...(body.defaultServiceCalendarId !== undefined
              ? ["defaultServiceCalendarId"]
              : []),
          ];
          const actuallyChanged = changedFields.filter((field) =>
            field === "defaultSlaPolicyId"
              ? body.defaultSlaPolicyId !== current.defaultSlaPolicyId
              : body.defaultServiceCalendarId !==
                current.defaultServiceCalendarId,
          );
          if (actuallyChanged.length === 0)
            return readProjectSettings(tx, workspaceId);
          const [updated] = await tx
            .update(schema.workspaceTable)
            .set({
              ...(body.defaultSlaPolicyId !== undefined
                ? { defaultSlaPolicyId: body.defaultSlaPolicyId }
                : {}),
              ...(body.defaultServiceCalendarId !== undefined
                ? { defaultServiceCalendarId: body.defaultServiceCalendarId }
                : {}),
              projectSettingsVersion: sql`${schema.workspaceTable.projectSettingsVersion} + 1`,
            })
            .where(eq(schema.workspaceTable.id, workspaceId))
            .returning({
              projectSettingsVersion:
                schema.workspaceTable.projectSettingsVersion,
            });
          if (!updated)
            throw new HTTPException(404, { message: "Workspace not found" });
          auditFailed = await appendSettingsAudit(tx, {
            actor,
            workspaceId,
            action: "workspace.project_settings_updated",
            entityType: "workspace",
            entityId: workspaceId,
            before: { version: current.projectSettingsVersion },
            after: {
              version: updated.projectSettingsVersion,
              changedFields: actuallyChanged,
            },
          });
          return readProjectSettings(tx, workspaceId);
        },
      );
    } catch (error) {
      if (error instanceof WorkspaceSettingsVersionConflict)
        return c.json(
          {
            message: "workspace_project_settings_conflict" as const,
            currentVersion: error.currentVersion,
          },
          409,
        );
      throw error;
    }
    if (auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    c.header("Cache-Control", "no-store");
    return c.json(result, 200);
  })
  .openapi(listStateTemplatesRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { workspace, templates } = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({
          projectSettingsVersion: schema.workspaceTable.projectSettingsVersion,
        })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .for("share")
        .limit(1);
      if (!workspace)
        throw new HTTPException(404, { message: "Workspace not found" });
      const templates = await tx
        .select({
          id: schema.stateTemplateTable.id,
          key: schema.stateTemplateTable.key,
          name: schema.stateTemplateTable.name,
          group: schema.stateTemplateTable.group,
          archivedAt: schema.stateTemplateTable.archivedAt,
        })
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, workspaceId))
        .orderBy(
          asc(schema.stateTemplateTable.key),
          asc(schema.stateTemplateTable.id),
        );
      return { workspace, templates };
    });
    c.header("Cache-Control", "no-store");
    return c.json(
      workspaceStateTemplateListSchema.parse({
        workspaceId,
        version: workspace.projectSettingsVersion,
        templates: templates.map(({ archivedAt, ...template }) => ({
          ...template,
          group: template.group as
            | "backlog"
            | "unstarted"
            | "started"
            | "completed"
            | "cancelled",
          enabled: archivedAt === null,
        })),
      }),
      200,
    );
  })
  .openapi(createStateTemplateRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = auditActor(c);
    let auditFailed = false;
    let created:
      | {
          id: string;
          key: string;
          name: string;
          group: string;
          enabled: boolean;
        }
      | undefined;
    try {
      await withWorkspaceDeletionAccessLifecycle(workspaceId, async (tx) => {
        const current = await currentWorkspaceSettings(tx, workspaceId);
        if (current.projectSettingsVersion !== body.expectedVersion)
          throw new WorkspaceSettingsVersionConflict(
            current.projectSettingsVersion,
          );
        const inheritingProjects = await tx
          .select({ id: schema.projectTable.id })
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.workspaceId, workspaceId),
              eq(schema.projectTable.stateSetMode, "inherit"),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .orderBy(asc(schema.projectTable.id))
          .for("update");
        const [template] = await tx
          .insert(schema.stateTemplateTable)
          .values({
            workspaceId,
            key: body.key,
            name: body.name,
            group: body.group,
          })
          .returning({
            id: schema.stateTemplateTable.id,
            key: schema.stateTemplateTable.key,
            name: schema.stateTemplateTable.name,
            group: schema.stateTemplateTable.group,
          });
        if (!template) throw new Error("State template insert returned no row");
        for (const project of inheritingProjects) {
          const rows = await tx
            .select({
              id: schema.stateTable.id,
              stateTemplateId: schema.stateTable.stateTemplateId,
              position: schema.stateTable.position,
              isDefault: schema.stateTable.isDefault,
            })
            .from(schema.stateTable)
            .where(eq(schema.stateTable.projectId, project.id))
            .orderBy(
              asc(schema.stateTable.position),
              asc(schema.stateTable.id),
            );
          const existing = rows.find(
            (row) => row.stateTemplateId === template.id,
          );
          if (existing) {
            await tx
              .update(schema.stateTable)
              .set({ archivedAt: null })
              .where(eq(schema.stateTable.id, existing.id));
            continue;
          }
          const [last] = rows.slice(-1);
          await tx.insert(schema.stateTable).values({
            projectId: project.id,
            stateTemplateId: template.id,
            position: (last?.position ?? -1) + 1,
            isDefault: rows.length === 0,
          });
        }
        const [updated] = await tx
          .update(schema.workspaceTable)
          .set({
            projectSettingsVersion: sql`${schema.workspaceTable.projectSettingsVersion} + 1`,
          })
          .where(eq(schema.workspaceTable.id, workspaceId))
          .returning({
            projectSettingsVersion:
              schema.workspaceTable.projectSettingsVersion,
          });
        if (!updated)
          throw new HTTPException(404, { message: "Workspace not found" });
        auditFailed = await appendSettingsAudit(tx, {
          actor,
          workspaceId,
          action: "state_template.created",
          entityType: "state_template",
          entityId: template.id,
          before: { enabled: false },
          after: {
            version: updated.projectSettingsVersion,
            changedFields: ["created", "enabled"],
          },
        });
        created = { ...template, group: template.group, enabled: true };
      });
    } catch (error) {
      if (error instanceof WorkspaceSettingsVersionConflict)
        return c.json(
          {
            message: "workspace_project_settings_conflict" as const,
            currentVersion: error.currentVersion,
          },
          409,
        );
      if (isUniqueViolation(error, ["state_template_workspace_key_unique"]))
        return c.json({ message: "state_template_key_taken" as const }, 409);
      throw error;
    }
    if (auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return c.json(workspaceStateTemplateSchema.parse(created), 201);
  })
  .openapi(updateStateTemplateRoute, async (c) => {
    const { workspaceId, stateTemplateId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = auditActor(c);
    let auditFailed = false;
    let updatedResult:
      | {
          id: string;
          key: string;
          name: string;
          group: string;
          enabled: boolean;
        }
      | undefined;
    try {
      await withWorkspaceDeletionAccessLifecycle(workspaceId, async (tx) => {
        const current = await currentWorkspaceSettings(tx, workspaceId);
        if (current.projectSettingsVersion !== body.expectedVersion)
          throw new WorkspaceSettingsVersionConflict(
            current.projectSettingsVersion,
          );
        const inheritingProjects = await tx
          .select({ id: schema.projectTable.id })
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.workspaceId, workspaceId),
              eq(schema.projectTable.stateSetMode, "inherit"),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .orderBy(asc(schema.projectTable.id))
          .for("update");
        const [template] = await tx
          .select()
          .from(schema.stateTemplateTable)
          .where(
            and(
              eq(schema.stateTemplateTable.id, stateTemplateId),
              eq(schema.stateTemplateTable.workspaceId, workspaceId),
            ),
          )
          .for("update")
          .limit(1);
        if (!template)
          throw new HTTPException(404, { message: "State template not found" });
        const disabling =
          body.enabled === false && template.archivedAt === null;
        const enabling = body.enabled === true && template.archivedAt !== null;
        const changedFields = [
          ...(body.name !== undefined && body.name !== template.name
            ? ["name"]
            : []),
          ...(body.group !== undefined && body.group !== template.group
            ? ["group"]
            : []),
          ...(disabling || enabling ? ["enabled"] : []),
        ];
        if (changedFields.length === 0) {
          updatedResult = {
            id: template.id,
            key: template.key,
            name: template.name,
            group: template.group,
            enabled: template.archivedAt === null,
          };
          return;
        }
        if (disabling) {
          const activeTemplateIds = await listEnabledStateTemplateIds(
            tx,
            workspaceId,
          );
          if (activeTemplateIds.length <= 1)
            throw new HTTPException(409, {
              message: "workspace_requires_enabled_state",
            });
          const inheritingProjectIds = inheritingProjects.map(
            (project) => project.id,
          );
          const concreteStates = inheritingProjectIds.length
            ? await tx
                .select({
                  id: schema.stateTable.id,
                  projectId: schema.stateTable.projectId,
                })
                .from(schema.stateTable)
                .where(
                  and(
                    inArray(schema.stateTable.projectId, inheritingProjectIds),
                    eq(schema.stateTable.stateTemplateId, stateTemplateId),
                    isNull(schema.stateTable.archivedAt),
                  ),
                )
                .orderBy(
                  asc(schema.stateTable.projectId),
                  asc(schema.stateTable.id),
                )
                .for("update")
            : [];
          const stateIds = concreteStates.map((state) => state.id);
          const [affectedSummary] = stateIds.length
            ? await tx
                .select({ count: count() })
                .from(schema.workItemTable)
                .innerJoin(
                  schema.projectTable,
                  eq(schema.projectTable.id, schema.workItemTable.projectId),
                )
                .where(
                  and(
                    inArray(schema.workItemTable.stateId, stateIds),
                    eq(schema.projectTable.stateSetMode, "inherit"),
                    isNull(schema.projectTable.deletedAt),
                  ),
                )
            : [{ count: 0 }];
          const itemRows = stateIds.length
            ? await tx
                .select({
                  id: schema.workItemTable.id,
                  key: schema.workItemTable.key,
                  title: schema.workItemTable.title,
                  projectId: schema.workItemTable.projectId,
                  workspaceId: schema.projectTable.workspaceId,
                  organisationId: schema.projectTable.organisationId,
                  projectName: schema.projectTable.name,
                })
                .from(schema.workItemTable)
                .innerJoin(
                  schema.projectTable,
                  eq(schema.projectTable.id, schema.workItemTable.projectId),
                )
                .where(
                  and(
                    inArray(schema.workItemTable.stateId, stateIds),
                    eq(schema.projectTable.stateSetMode, "inherit"),
                    isNull(schema.projectTable.deletedAt),
                  ),
                )
                .orderBy(
                  asc(schema.projectTable.id),
                  asc(schema.workItemTable.id),
                )
                .limit(1000)
                .for("update", { of: schema.workItemTable })
            : [];
          if ((affectedSummary?.count ?? 0) > 0) {
            const reach = listReachOf(c);
            const projectScopes = await tx
              .select({
                projectId: schema.workItemTable.projectId,
                workspaceId: schema.projectTable.workspaceId,
                organisationId: schema.projectTable.organisationId,
              })
              .from(schema.workItemTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.projectTable.id, schema.workItemTable.projectId),
              )
              .where(
                and(
                  inArray(schema.workItemTable.stateId, stateIds),
                  eq(schema.projectTable.stateSetMode, "inherit"),
                  isNull(schema.projectTable.deletedAt),
                ),
              )
              .groupBy(
                schema.workItemTable.projectId,
                schema.projectTable.workspaceId,
                schema.projectTable.organisationId,
              );
            const readableProjects = new Set<string>();
            for (const scope of projectScopes) {
              if (await reach.can("work_item:read", scope))
                readableProjects.add(scope.projectId);
            }
            const visibleRows: typeof itemRows = [];
            for (const row of itemRows) {
              if (readableProjects.has(row.projectId)) {
                visibleRows.push(row);
                if (visibleRows.length === 100) break;
              }
            }
            throw new WorkspaceStateInUse({
              code: "state_in_use",
              hasHiddenAffectedItems: projectScopes.some(
                (scope) => !readableProjects.has(scope.projectId),
              ),
              affectedItems: visibleRows.map(
                ({
                  workspaceId: _workspaceId,
                  organisationId: _organisationId,
                  ...row
                }) => row,
              ),
            });
          }
          for (const projectId of inheritingProjectIds) {
            const activeRows = await tx
              .select({
                id: schema.stateTable.id,
                isDefault: schema.stateTable.isDefault,
                position: schema.stateTable.position,
              })
              .from(schema.stateTable)
              .where(
                and(
                  eq(schema.stateTable.projectId, projectId),
                  isNull(schema.stateTable.archivedAt),
                ),
              )
              .orderBy(
                asc(schema.stateTable.position),
                asc(schema.stateTable.id),
              );
            const retiring = activeRows.find((row) =>
              stateIds.includes(row.id),
            );
            if (retiring?.isDefault) {
              const next = activeRows.find((row) => row.id !== retiring.id);
              if (next) {
                await tx
                  .update(schema.stateTable)
                  .set({ isDefault: false })
                  .where(
                    and(
                      eq(schema.stateTable.projectId, projectId),
                      eq(schema.stateTable.isDefault, true),
                    ),
                  );
                await tx
                  .update(schema.stateTable)
                  .set({ isDefault: true })
                  .where(eq(schema.stateTable.id, next.id));
              }
            }
          }
          if (stateIds.length) {
            await tx
              .update(schema.stateTable)
              .set({ archivedAt: new Date(), isDefault: false })
              .where(inArray(schema.stateTable.id, stateIds));
          }
        }
        if (enabling) {
          for (const project of inheritingProjects) {
            const [existing] = await tx
              .select({
                id: schema.stateTable.id,
                position: schema.stateTable.position,
              })
              .from(schema.stateTable)
              .where(
                and(
                  eq(schema.stateTable.projectId, project.id),
                  eq(schema.stateTable.stateTemplateId, stateTemplateId),
                ),
              )
              .for("update")
              .limit(1);
            if (existing) {
              await tx
                .update(schema.stateTable)
                .set({ archivedAt: null })
                .where(eq(schema.stateTable.id, existing.id));
            } else {
              const [last] = await tx
                .select({ position: schema.stateTable.position })
                .from(schema.stateTable)
                .where(eq(schema.stateTable.projectId, project.id))
                .orderBy(
                  desc(schema.stateTable.position),
                  desc(schema.stateTable.id),
                )
                .limit(1);
              const [activeDefault] = await tx
                .select({ id: schema.stateTable.id })
                .from(schema.stateTable)
                .where(
                  and(
                    eq(schema.stateTable.projectId, project.id),
                    isNull(schema.stateTable.archivedAt),
                    eq(schema.stateTable.isDefault, true),
                  ),
                )
                .limit(1);
              await tx.insert(schema.stateTable).values({
                projectId: project.id,
                stateTemplateId,
                position: (last?.position ?? -1) + 1,
                isDefault: !activeDefault,
              });
            }
          }
        }
        const [updated] = await tx
          .update(schema.stateTemplateTable)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.group !== undefined ? { group: body.group } : {}),
            ...(disabling ? { archivedAt: new Date() } : {}),
            ...(enabling ? { archivedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.stateTemplateTable.id, stateTemplateId))
          .returning({
            id: schema.stateTemplateTable.id,
            key: schema.stateTemplateTable.key,
            name: schema.stateTemplateTable.name,
            group: schema.stateTemplateTable.group,
            archivedAt: schema.stateTemplateTable.archivedAt,
          });
        if (!updated)
          throw new HTTPException(404, { message: "State template not found" });
        const [versioned] = await tx
          .update(schema.workspaceTable)
          .set({
            projectSettingsVersion: sql`${schema.workspaceTable.projectSettingsVersion} + 1`,
          })
          .where(eq(schema.workspaceTable.id, workspaceId))
          .returning({
            projectSettingsVersion:
              schema.workspaceTable.projectSettingsVersion,
          });
        if (!versioned)
          throw new HTTPException(404, { message: "Workspace not found" });
        auditFailed = await appendSettingsAudit(tx, {
          actor,
          workspaceId,
          action: "state_template.updated",
          entityType: "state_template",
          entityId: updated.id,
          before: {
            version: current.projectSettingsVersion,
            enabled: template.archivedAt === null,
          },
          after: { version: versioned.projectSettingsVersion, changedFields },
        });
        updatedResult = {
          id: updated.id,
          key: updated.key,
          name: updated.name,
          group: updated.group,
          enabled: updated.archivedAt === null,
        };
      });
    } catch (error) {
      if (error instanceof WorkspaceSettingsVersionConflict)
        return c.json(
          {
            message: "workspace_project_settings_conflict" as const,
            currentVersion: error.currentVersion,
          },
          409,
        );
      if (error instanceof WorkspaceStateInUse)
        return c.json(error.payload, 409);
      throw error;
    }
    if (auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return c.json(workspaceStateTemplateSchema.parse(updatedResult), 200);
  });

export default workspaceProjectSettingsApi;

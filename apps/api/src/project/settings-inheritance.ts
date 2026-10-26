import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { listReachOf, requireReachContext } from "../utils/reach-filtered-list";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  inheritProjectStateSetBodySchema,
  projectSettingsInheritanceSchema,
  stateSetConflictSchema,
  updateProjectSettingsInheritanceBodySchema,
} from "../workspace/project-settings-schema";
import {
  resolveProjectServiceCalendarId,
  resolveProjectSetting,
} from "./effective-settings";

const projectParam = z.object({ projectId: z.string().min(1).max(128) });
const inheritanceConflictSchema = z.object({
  message: z.literal("project_settings_conflict"),
  projectVersion: z.number().int().positive(),
  workspaceVersion: z.number().int().positive(),
});
const inheritStateSetConflictSchema = z.union([
  inheritanceConflictSchema,
  stateSetConflictSchema,
]);
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

class SettingsConflict extends Error {
  constructor(
    readonly projectVersion: number,
    readonly workspaceVersion: number,
  ) {
    super("project_settings_conflict");
  }
}

class StateSetInUse extends Error {
  constructor(readonly payload: z.infer<typeof stateSetConflictSchema>) {
    super("state_in_use");
  }
}

function actorOf(c: Context): Actor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    actorId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

async function appendProjectSettingsAudit(
  tx: Tx,
  input: {
    actor: Actor;
    workspaceId: string;
    projectId: string;
    before: number;
    after: number;
    changedFields: string[];
  },
) {
  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        apiKeyId: input.actor.apiKeyId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        action: "project.settings_updated",
        entityType: "project",
        entityId: input.projectId,
        before: { version: input.before },
        after: { version: input.after, changedFields: input.changedFields },
      }),
    );
    return false;
  } catch {
    recordAuditWriteFailure("mutation");
    return true;
  }
}

async function readInheritance(tx: Tx, projectId: string) {
  const [row] = await tx
    .select({
      projectId: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      projectVersion: schema.projectTable.projectSettingsVersion,
      workspaceVersion: schema.workspaceTable.projectSettingsVersion,
      slaPolicyId: schema.projectTable.slaPolicyId,
      slaPolicyMode: schema.projectTable.slaPolicyMode,
      serviceCalendarId: schema.projectTable.serviceCalendarId,
      serviceCalendarMode: schema.projectTable.serviceCalendarMode,
      stateSetMode: schema.projectTable.stateSetMode,
      workspaceSlaPolicyId: schema.workspaceTable.defaultSlaPolicyId,
      workspaceCalendarId: schema.workspaceTable.defaultServiceCalendarId,
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
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Project not found" });
  const sla = resolveProjectSetting({
    mode: row.slaPolicyMode as "inherit" | "override",
    overrideId: row.slaPolicyId,
    workspaceDefaultId: row.workspaceSlaPolicyId,
  });
  const calendar = resolveProjectSetting({
    mode: row.serviceCalendarMode as "inherit" | "override",
    overrideId: row.serviceCalendarId,
    workspaceDefaultId: row.workspaceCalendarId,
  });
  const [slaPolicy] = sla.effectiveId
    ? await tx
        .select({ name: schema.slaPolicyTable.name })
        .from(schema.slaPolicyTable)
        .where(eq(schema.slaPolicyTable.id, sla.effectiveId))
        .limit(1)
    : [];
  const [serviceCalendar] = calendar.effectiveId
    ? await tx
        .select({ name: schema.serviceCalendarTable.name })
        .from(schema.serviceCalendarTable)
        .where(eq(schema.serviceCalendarTable.id, calendar.effectiveId))
        .limit(1)
    : [];
  const [activeStates, workspaceStates] = await Promise.all([
    tx
      .select({ id: schema.stateTable.stateTemplateId })
      .from(schema.stateTable)
      .where(
        and(
          eq(schema.stateTable.projectId, projectId),
          isNull(schema.stateTable.archivedAt),
        ),
      )
      .orderBy(asc(schema.stateTable.position), asc(schema.stateTable.id)),
    tx
      .select({ id: schema.stateTemplateTable.id })
      .from(schema.stateTemplateTable)
      .where(
        and(
          eq(schema.stateTemplateTable.workspaceId, row.workspaceId),
          isNull(schema.stateTemplateTable.archivedAt),
        ),
      )
      .orderBy(
        asc(schema.stateTemplateTable.key),
        asc(schema.stateTemplateTable.id),
      ),
  ]);
  return projectSettingsInheritanceSchema.parse({
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    projectVersion: row.projectVersion,
    workspaceVersion: row.workspaceVersion,
    slaPolicy: { ...sla, effectiveName: slaPolicy?.name ?? null },
    serviceCalendar: {
      ...calendar,
      effectiveName: serviceCalendar?.name ?? null,
    },
    states: {
      mode: row.stateSetMode,
      activeTemplateIds: activeStates.map((state) => state.id),
      workspaceTemplateIds: workspaceStates.map((state) => state.id),
    },
  });
}

const getInheritanceRoute = createRoute({
  method: "get",
  path: "/{projectId}/settings/inheritance",
  operationId: "getProjectSettingsInheritance",
  tags: ["Projects"],
  summary: "Get effective SLA, calendar and state-set settings",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse(
      "Project settings inheritance",
      projectSettingsInheritanceSchema,
    ),
    404: errorResponse("Project not found"),
  },
});

const updateInheritanceRoute = createRoute({
  method: "patch",
  path: "/{projectId}/settings/inheritance",
  operationId: "updateProjectSettingsInheritance",
  tags: ["Projects"],
  summary: "Set project SLA and calendar inheritance",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireWorkspaceCapability("project:manage_settings"),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: updateProjectSettingsInheritanceBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Updated project settings inheritance",
      projectSettingsInheritanceSchema,
    ),
    403: errorResponse("Missing project:manage_settings capability"),
    404: errorResponse("Project or referenced setting not found"),
    409: jsonResponse(
      "Project settings changed since they were loaded",
      inheritanceConflictSchema,
    ),
    422: errorResponse("Referenced setting is unavailable in this workspace"),
  },
});

const inheritStateSetRoute = createRoute({
  method: "patch",
  path: "/{projectId}/state-set",
  operationId: "inheritProjectStateSet",
  tags: ["Projects"],
  summary: "Adopt the enabled workspace state set",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
    requireWorkspaceCapability("project:manage_settings"),
    requireReachContext,
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: inheritProjectStateSetBodySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Inherited project state set",
      projectSettingsInheritanceSchema,
    ),
    403: errorResponse("Missing project:manage_settings capability"),
    404: errorResponse("Project not found"),
    409: jsonResponse(
      "Project settings changed or a state is still in use",
      inheritStateSetConflictSchema,
    ),
  },
});

export const projectSettingsInheritanceApi = apiRouter()
  .openapi(getInheritanceRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const value = await db.transaction(async (tx) =>
      readInheritance(tx, projectId),
    );
    c.header("Cache-Control", "no-store");
    return c.json(value, 200);
  })
  .openapi(updateInheritanceRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = actorOf(c);
    let auditFailed = false;
    try {
      const result = await db.transaction(async (tx) => {
        const [workspace] = await tx
          .select({
            id: schema.workspaceTable.id,
            version: schema.workspaceTable.projectSettingsVersion,
            defaultServiceCalendarId:
              schema.workspaceTable.defaultServiceCalendarId,
          })
          .from(schema.workspaceTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTable.workspaceId, schema.workspaceTable.id),
          )
          .where(
            and(
              eq(schema.projectTable.id, projectId),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .for("share")
          .limit(1);
        if (!workspace)
          throw new HTTPException(404, { message: "Project not found" });
        const [project] = await tx
          .select()
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.id, projectId),
              eq(schema.projectTable.workspaceId, workspace.id),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!project)
          throw new HTTPException(404, { message: "Project not found" });
        if (
          project.projectSettingsVersion !== body.expectedProjectVersion ||
          workspace.version !== body.expectedWorkspaceVersion
        )
          throw new SettingsConflict(
            project.projectSettingsVersion,
            workspace.version,
          );
        if (body.slaPolicy?.mode === "override" && body.slaPolicy.id) {
          const [policy] = await tx
            .select({
              id: schema.slaPolicyTable.id,
              activeVersionId: schema.slaPolicyTable.activeVersionId,
            })
            .from(schema.slaPolicyTable)
            .where(
              and(
                eq(schema.slaPolicyTable.id, body.slaPolicy.id),
                eq(schema.slaPolicyTable.workspaceId, workspace.id),
              ),
            )
            .limit(1);
          if (!policy?.activeVersionId)
            throw new HTTPException(422, {
              message: "SLA policy is unavailable",
            });
        }
        if (
          body.serviceCalendar?.mode === "override" &&
          body.serviceCalendar.id
        ) {
          const [calendar] = await tx
            .select({ id: schema.serviceCalendarTable.id })
            .from(schema.serviceCalendarTable)
            .where(
              and(
                eq(schema.serviceCalendarTable.id, body.serviceCalendar.id),
                eq(schema.serviceCalendarTable.workspaceId, workspace.id),
              ),
            )
            .limit(1);
          if (!calendar)
            throw new HTTPException(422, {
              message: "Service calendar is unavailable",
            });
        }
        const nextCalendarMode =
          body.serviceCalendar?.mode ?? project.serviceCalendarMode;
        const nextCalendarOverride = body.serviceCalendar
          ? body.serviceCalendar.mode === "override"
            ? body.serviceCalendar.id
            : null
          : project.serviceCalendarId;
        const effectiveCalendarId = resolveProjectServiceCalendarId({
          mode: nextCalendarMode as "inherit" | "override",
          overrideId: nextCalendarOverride,
          workspaceDefaultId: workspace.defaultServiceCalendarId,
        });
        if (
          project.kind === "managed_service" &&
          (!project.supportLevel || !effectiveCalendarId)
        )
          throw new HTTPException(422, {
            message: "managed_service_requires_effective_calendar",
          });
        const slaChanged =
          body.slaPolicy !== undefined &&
          (body.slaPolicy.mode !== project.slaPolicyMode ||
            (body.slaPolicy.mode === "override" &&
              body.slaPolicy.id !== project.slaPolicyId));
        const calendarChanged =
          body.serviceCalendar !== undefined &&
          (body.serviceCalendar.mode !== project.serviceCalendarMode ||
            (body.serviceCalendar.mode === "override" &&
              body.serviceCalendar.id !== project.serviceCalendarId));
        const changedFields = [
          ...(slaChanged ? ["slaPolicy"] : []),
          ...(calendarChanged ? ["serviceCalendar"] : []),
        ];
        if (changedFields.length === 0) return readInheritance(tx, projectId);
        await tx
          .update(schema.projectTable)
          .set({
            ...(slaChanged && body.slaPolicy
              ? {
                  slaPolicyMode: body.slaPolicy.mode,
                  slaPolicyId:
                    body.slaPolicy.mode === "override"
                      ? body.slaPolicy.id
                      : null,
                }
              : {}),
            ...(calendarChanged && body.serviceCalendar
              ? {
                  serviceCalendarMode: body.serviceCalendar.mode,
                  serviceCalendarId:
                    body.serviceCalendar.mode === "override"
                      ? body.serviceCalendar.id
                      : null,
                }
              : {}),
            projectSettingsVersion: sql`${schema.projectTable.projectSettingsVersion} + 1`,
          })
          .where(eq(schema.projectTable.id, projectId));
        auditFailed = await appendProjectSettingsAudit(tx, {
          actor,
          workspaceId: workspace.id,
          projectId,
          before: project.projectSettingsVersion,
          after: project.projectSettingsVersion + 1,
          changedFields,
        });
        return readInheritance(tx, projectId);
      });
      if (auditFailed)
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof SettingsConflict)
        return c.json(
          {
            message: "project_settings_conflict" as const,
            projectVersion: error.projectVersion,
            workspaceVersion: error.workspaceVersion,
          },
          409,
        );
      throw error;
    }
  })
  .openapi(inheritStateSetRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = actorOf(c);
    let auditFailed = false;
    try {
      const result = await db.transaction(async (tx) => {
        const [workspace] = await tx
          .select({
            id: schema.workspaceTable.id,
            version: schema.workspaceTable.projectSettingsVersion,
          })
          .from(schema.workspaceTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTable.workspaceId, schema.workspaceTable.id),
          )
          .where(
            and(
              eq(schema.projectTable.id, projectId),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .for("share")
          .limit(1);
        if (!workspace)
          throw new HTTPException(404, { message: "Project not found" });
        const [project] = await tx
          .select()
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.id, projectId),
              eq(schema.projectTable.workspaceId, workspace.id),
              isNull(schema.projectTable.deletedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!project)
          throw new HTTPException(404, { message: "Project not found" });
        if (
          project.projectSettingsVersion !== body.expectedProjectVersion ||
          workspace.version !== body.expectedWorkspaceVersion
        )
          throw new SettingsConflict(
            project.projectSettingsVersion,
            workspace.version,
          );
        if (project.stateSetMode === "inherit")
          return readInheritance(tx, projectId);
        const templates = await tx
          .select({ id: schema.stateTemplateTable.id })
          .from(schema.stateTemplateTable)
          .where(
            and(
              eq(schema.stateTemplateTable.workspaceId, workspace.id),
              isNull(schema.stateTemplateTable.archivedAt),
            ),
          )
          .orderBy(
            asc(schema.stateTemplateTable.key),
            asc(schema.stateTemplateTable.id),
          );
        const desired = new Set(templates.map((template) => template.id));
        const existing = await tx
          .select({
            id: schema.stateTable.id,
            templateId: schema.stateTable.stateTemplateId,
            position: schema.stateTable.position,
            isDefault: schema.stateTable.isDefault,
            archivedAt: schema.stateTable.archivedAt,
          })
          .from(schema.stateTable)
          .where(eq(schema.stateTable.projectId, projectId))
          .orderBy(asc(schema.stateTable.position), asc(schema.stateTable.id))
          .for("update");
        const obsolete = existing.filter(
          (state) =>
            state.archivedAt === null && !desired.has(state.templateId),
        );
        if (obsolete.length) {
          const [itemCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.workItemTable)
            .where(
              inArray(
                schema.workItemTable.stateId,
                obsolete.map((state) => state.id),
              ),
            );
          if ((itemCount?.count ?? 0) > 0) {
            const visible = await tx
              .select({
                id: schema.workItemTable.id,
                key: schema.workItemTable.key,
                title: schema.workItemTable.title,
                projectId: schema.workItemTable.projectId,
                projectName: schema.projectTable.name,
                workspaceId: schema.projectTable.workspaceId,
                organisationId: schema.projectTable.organisationId,
              })
              .from(schema.workItemTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.projectTable.id, schema.workItemTable.projectId),
              )
              .where(
                inArray(
                  schema.workItemTable.stateId,
                  obsolete.map((state) => state.id),
                ),
              )
              .limit(100);
            const reach = listReachOf(c);
            const canRead = new Set<string>();
            for (const item of visible) {
              if (
                await reach.can("work_item:read", {
                  id: item.id,
                  projectId: item.projectId,
                  workspaceId: item.workspaceId,
                  organisationId: item.organisationId,
                })
              )
                canRead.add(item.id);
            }
            const affectedItems = visible
              .filter((item) => canRead.has(item.id))
              .map(
                ({
                  workspaceId: _workspaceId,
                  organisationId: _organisationId,
                  ...item
                }) => item,
              );
            throw new StateSetInUse({
              code: "state_in_use",
              hasHiddenAffectedItems:
                affectedItems.length < (itemCount?.count ?? 0),
              affectedItems,
            });
          }
        }
        let nextPosition =
          existing.reduce((max, state) => Math.max(max, state.position), -1) +
          1;
        const activeAfter: Array<{
          id: string;
          position: number;
          isDefault: boolean;
        }> = [];
        for (const template of templates) {
          const prior = existing.find(
            (state) => state.templateId === template.id,
          );
          if (prior) {
            if (prior.archivedAt !== null)
              await tx
                .update(schema.stateTable)
                .set({ archivedAt: null })
                .where(eq(schema.stateTable.id, prior.id));
            activeAfter.push({
              id: prior.id,
              position: prior.position,
              isDefault: prior.isDefault,
            });
          } else {
            const [created] = await tx
              .insert(schema.stateTable)
              .values({
                projectId,
                stateTemplateId: template.id,
                position: nextPosition++,
                isDefault: false,
              })
              .returning({
                id: schema.stateTable.id,
                position: schema.stateTable.position,
              });
            if (created) activeAfter.push({ ...created, isDefault: false });
          }
        }
        const obsoleteIds = obsolete.map((state) => state.id);
        if (obsoleteIds.length)
          await tx
            .update(schema.stateTable)
            .set({ archivedAt: new Date(), isDefault: false })
            .where(inArray(schema.stateTable.id, obsoleteIds));
        if (!activeAfter.some((state) => state.isDefault) && activeAfter[0]) {
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
            .where(eq(schema.stateTable.id, activeAfter[0].id));
        }
        await tx
          .update(schema.projectTable)
          .set({
            stateSetMode: "inherit",
            projectSettingsVersion: sql`${schema.projectTable.projectSettingsVersion} + 1`,
          })
          .where(eq(schema.projectTable.id, projectId));
        auditFailed = await appendProjectSettingsAudit(tx, {
          actor,
          workspaceId: workspace.id,
          projectId,
          before: project.projectSettingsVersion,
          after: project.projectSettingsVersion + 1,
          changedFields: ["stateSetMode"],
        });
        return readInheritance(tx, projectId);
      });
      if (auditFailed)
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof SettingsConflict)
        return c.json(
          {
            message: "project_settings_conflict" as const,
            projectVersion: error.projectVersion,
            workspaceVersion: error.workspaceVersion,
          },
          409,
        );
      if (error instanceof StateSetInUse) return c.json(error.payload, 409);
      throw error;
    }
  });

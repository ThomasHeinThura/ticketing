import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./fixtures";
import { addMember } from "./reach-world";

export const JSON_HEADERS = { "content-type": "application/json" };
type User = Parameters<typeof mockAuthenticatedSession>[0];
export type StateGroup =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

export async function setAgileFlags(
  projectId: string,
  flags: { cycles?: boolean; modules?: boolean; estimates?: boolean },
) {
  const entries: Array<[string, boolean | undefined]> = [
    ["feature.cycles", flags.cycles],
    ["feature.modules", flags.modules],
    ["feature.estimates", flags.estimates],
  ];
  for (const [featureKey, enabled] of entries) {
    if (enabled === undefined) continue;
    await db
      .insert(schema.projectFeatureFlagTable)
      .values({ projectId, featureKey, enabled })
      .onConflictDoUpdate({
        target: [
          schema.projectFeatureFlagTable.projectId,
          schema.projectFeatureFlagTable.featureKey,
        ],
        set: { enabled },
      });
  }
}

/** Direct rows for work items in a project, one state per lifecycle group. */
export async function itemWorld(workspaceId: string, projectId: string) {
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const states = new Map<StateGroup, string>();
  for (const group of [
    "backlog",
    "started",
    "completed",
    "cancelled",
  ] as StateGroup[]) {
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `state-${randomUUID()}`,
          name: group,
          group,
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId,
          stateTemplateId: template.id,
          isDefault: group === "backlog",
        })
        .returning(),
      "state",
    );
    states.set(group, state.id);
  }
  let number = 0;
  async function makeItem(
    title: string,
    options: {
      group?: StateGroup;
      estimatePointId?: string | null;
      parentId?: string | null;
      resolvedAt?: Date | null;
    } = {},
  ) {
    number += 1;
    const group = options.group ?? "backlog";
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId,
          projectId,
          typeId: type.id,
          stateId: states.get(group) as string,
          title,
          number,
          key: `AGL-${randomUUID().slice(0, 8)}`,
          estimatePointId: options.estimatePointId ?? null,
          parentId: options.parentId ?? null,
          resolvedAt:
            options.resolvedAt ??
            (group === "completed" || group === "cancelled"
              ? new Date()
              : null),
        })
        .returning(),
      "item",
    );
  }
  return { makeItem };
}

/**
 * One workspace: a manager (project:manage_settings + work_item:update on the project), a reader
 * (project:read only), an outsider (no project role), a second project and a foreign workspace.
 */
export async function agileWorld(
  flags: { cycles?: boolean; modules?: boolean; estimates?: boolean } = {
    cycles: true,
    modules: true,
    estimates: true,
  },
) {
  const manager = await createWorkspaceMember({ role: "owner" });
  const workspaceId = manager.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const { project: otherProject } = await createProjectFixture({ workspaceId });
  await grantProjectRole(manager.user.id, project.id, [
    "project:read",
    "project:manage_settings",
    "work_item:read",
    "work_item:update",
  ]);
  await grantProjectRole(manager.user.id, otherProject.id, [
    "project:read",
    "project:manage_settings",
    "work_item:read",
    "work_item:update",
  ]);
  const reader = await addMember(workspaceId, "member");
  await grantProjectRole(reader.user.id, project.id, [
    "project:read",
    "work_item:read",
  ]);
  const outsider = await addMember(workspaceId, "member");
  const foreign = await createWorkspaceMember({ role: "owner" });
  const { project: foreignProject } = await createProjectFixture({
    workspaceId: foreign.workspace.id,
  });
  await grantProjectRole(foreign.user.id, foreignProject.id, [
    "project:read",
    "project:manage_settings",
    "work_item:read",
    "work_item:update",
  ]);
  await setAgileFlags(project.id, flags);
  await setAgileFlags(otherProject.id, flags);
  await setAgileFlags(foreignProject.id, flags);
  const items = await itemWorld(workspaceId, project.id);
  const otherItems = await itemWorld(workspaceId, otherProject.id);
  const { app } = createApp();

  function call(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user);
    return app.request(path, {
      method: init.method ?? "GET",
      headers: JSON_HEADERS,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  async function json<T>(response: Response, status = 200): Promise<T> {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  }
  return {
    manager,
    reader,
    outsider,
    foreign,
    workspaceId,
    project,
    otherProject,
    foreignProject,
    items,
    otherItems,
    app,
    call,
    json,
  };
}
export type AgileWorld = Awaited<ReturnType<typeof agileWorld>>;

export async function auditActionsFor(entityId: string) {
  const rows = await db
    .select({ action: schema.auditLogTable.action })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.entityId, entityId));
  return rows.map((row) => row.action);
}

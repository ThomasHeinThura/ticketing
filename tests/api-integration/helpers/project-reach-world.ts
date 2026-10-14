import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { mockAuthenticatedSession } from "./auth";
import { createProjectFixture, grantProjectRole, requireRow } from "./fixtures";
import { type App, addMember, json, setupWorld } from "./reach-world";

/**
 * Project-level authority for a caller who must pass project reach AND the registered
 * capability on the project-scoped routes (#720). Workspace role is a separate, legacy gate.
 */
export const PROJECT_ADMIN_CAPABILITIES = [
  "project:read",
  "project:update",
  "project:delete",
  "project:manage_settings",
  "work_item:read",
  "work_item:create",
  "work_item:update",
  "work_item:delete",
  "work_item:assign",
  "label:manage",
  "time_entry:create",
  "time_entry:read_any",
  "time_entry:update_any",
  "workspace:read",
] as const;

/** An API-key permission scope wide enough for every project-scoped route. */
export const PROJECT_KEY_SCOPE = {
  project: ["read", "create", "update", "delete", "manage_settings"],
  work_item: ["read", "create", "update", "delete", "assign"],
  label: ["create", "update", "delete"],
  time_entry: ["create", "read_any", "update_any"],
  workspace: ["read"],
};

export const READ_ONLY_KEY_SCOPE = {
  project: ["read"],
  work_item: ["read"],
  workspace: ["read"],
};

export async function setupProjectWorld() {
  const world = await setupWorld();
  const projectAdmin = await addMember(world.workspaceId, "admin");
  await grantProjectRole(projectAdmin.user.id, world.project.id, [
    ...PROJECT_ADMIN_CAPABILITIES,
  ]);
  // A workspace admin whose PROJECT role is read-only: it passes the legacy workspace gates
  // and project reach, and is refused only by the project-level capability decision.
  const readerAdmin = await addMember(world.workspaceId, "admin");
  await grantProjectRole(readerAdmin.user.id, world.project.id, [
    "project:read",
    "work_item:read",
  ]);

  // A second project in the same workspace, and a caller who is fully capable THERE but
  // has no membership of the first: workspace membership and a strong role are not reach.
  const { project: otherProject } = await createProjectFixture({
    workspaceId: world.workspaceId,
    name: "Other project",
  });
  const otherProjectAdmin = await addMember(world.workspaceId, "admin");
  await grantProjectRole(otherProjectAdmin.user.id, otherProject.id, [
    ...PROJECT_ADMIN_CAPABILITIES,
  ]);
  return {
    ...world,
    projectAdmin,
    readerAdmin,
    otherProject,
    otherProjectAdmin,
  };
}

export type ProjectWorld = Awaited<ReturnType<typeof setupProjectWorld>>;

export type Ids = {
  projectId: string;
  columnId: string;
  ruleId: string;
  milestoneId: string;
  prerequisiteId: string;
  stakeholderId: string;
  documentLinkId: string;
  taskId: string;
};

/** Ids that resolve to nothing, in the same shape as the real ones. */
export function missingIds(): Ids {
  const missing = () => `missing-${randomUUID()}`;
  return {
    projectId: missing(),
    columnId: missing(),
    ruleId: missing(),
    milestoneId: missing(),
    prerequisiteId: missing(),
    stakeholderId: missing(),
    documentLinkId: missing(),
    taskId: missing(),
  };
}

/** Real rows of every project child kind, created as a fully capable project member. */
export async function seedProjectRows(
  app: App,
  world: ProjectWorld,
): Promise<Ids> {
  mockAuthenticatedSession(world.projectAdmin.user);
  const projectId = world.project.id;
  const post = async (url: string, body: unknown) => {
    const response = await json(app, "POST", url, body);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as { id: string };
  };

  const milestone = await post(`/api/project/${projectId}/milestones`, {
    name: "Confidential milestone",
    date: "2030-01-01T00:00:00.000Z",
  });
  const prerequisite = await post(`/api/project/${projectId}/prerequisites`, {
    title: "Confidential prerequisite",
    ownerSide: "us",
  });
  const stakeholder = await post(`/api/project/${projectId}/stakeholders`, {
    personId: world.projectAdmin.personId,
    role: "sponsor",
    escalationOrder: 1,
  });
  const documentLink = await post(`/api/project/${projectId}/document-links`, {
    url: "https://example.com/confidential",
    title: "Confidential link",
  });

  const [column] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId))
    .limit(1);
  if (!column) throw new Error("project has no column");
  const [other] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId))
    .offset(1)
    .limit(1);
  const rule = requireRow(
    await db
      .insert(schema.workflowRuleTable)
      .values({
        projectId,
        integrationType: "github",
        eventType: "pull_request_opened",
        columnId: (other ?? column).id,
      })
      .returning(),
    "workflow rule",
  );
  // Through the API, so the project's task-number counter stays consistent with the rows.
  const task = await post(`/api/task/${projectId}`, {
    title: "Confidential legacy task",
    description: "d",
    priority: "medium",
    status: "to-do",
  });
  return {
    projectId,
    columnId: column.id,
    ruleId: rule.id,
    milestoneId: milestone.id,
    prerequisiteId: prerequisite.id,
    stakeholderId: stakeholder.id,
    documentLinkId: documentLink.id,
    taskId: task.id,
  };
}

/** Every table the project-scoped routes write, serialised, so "nothing written" is exact. */
export async function projectSnapshot() {
  const tables = {
    projects: await db
      .select()
      .from(schema.projectTable)
      .orderBy(schema.projectTable.id),
    columns: await db
      .select()
      .from(schema.columnTable)
      .orderBy(schema.columnTable.id),
    tasks: await db
      .select()
      .from(schema.taskTable)
      .orderBy(schema.taskTable.id),
    workItems: await db
      .select()
      .from(schema.workItemTable)
      .orderBy(schema.workItemTable.id),
    milestones: await db
      .select()
      .from(schema.milestoneTable)
      .orderBy(schema.milestoneTable.id),
    prerequisites: await db
      .select()
      .from(schema.prerequisiteTable)
      .orderBy(schema.prerequisiteTable.id),
    stakeholders: await db
      .select()
      .from(schema.stakeholderTable)
      .orderBy(schema.stakeholderTable.id),
    documentLinks: await db
      .select()
      .from(schema.documentLinkTable)
      .orderBy(schema.documentLinkTable.id),
    workflowRules: await db
      .select()
      .from(schema.workflowRuleTable)
      .orderBy(schema.workflowRuleTable.id),
    labels: await db
      .select()
      .from(schema.labelTable)
      .orderBy(schema.labelTable.id),
    timeEntries: await db
      .select()
      .from(schema.timeEntryTable)
      .orderBy(schema.timeEntryTable.id),
  };
  return JSON.stringify(tables);
}

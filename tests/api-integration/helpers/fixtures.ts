import { randomUUID } from "node:crypto";
import {
  DEFAULT_ROLE_NAMES,
  type DefaultRoleName,
  defaultRolePayloads,
} from "@taskdesk/permissions";
import db, { schema } from "../../../apps/api/src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../../../apps/api/src/project/controllers/create-project";

export type SeededMemberContext = {
  user: typeof schema.userTable.$inferSelect;
  workspace: typeof schema.workspaceTable.$inferSelect;
};

function isDefaultRoleName(role: string): role is DefaultRoleName {
  return (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
}

export async function createWorkspaceMember(
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
    /**
     * Whether to seed a `workspace_role` row for `role` when it names one
     * of the three default roles (viewer/member/admin) -- mirroring what
     * every real creation path now guarantees (issue #66: the native
     * create transaction and the plugin's `afterCreateOrganization` hook
     * both seed these unconditionally). Defaults to `true` so ordinary
     * RBAC fixtures reflect that guarantee rather than relying on the
     * fail-open fallback #66 removed. Set to `false` to deliberately
     * reproduce a missing-row condition.
     */
    seedDefaultRoleRow: boolean;
  }>,
): Promise<SeededMemberContext> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;
  const role = overrides?.role ?? "member";

  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: overrides?.userName || "Integration Test User",
    })
    .returning();

  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: workspaceId,
      createdAt: new Date(),
      name: overrides?.workspaceName || "Integration Test Workspace",
      slug: `workspace-${randomUUID()}`,
    })
    .returning();

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if ((overrides?.seedDefaultRoleRow ?? true) && isDefaultRoleName(role)) {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
      createdAt: now,
      updatedAt: now,
    });
  }

  return { user, workspace };
}

export async function createProjectFixture({
  workspaceId,
  name = "Integration Project",
  icon = "Folder",
  slug = `project-${randomUUID()}`,
}: {
  workspaceId: string;
  name?: string;
  icon?: string;
  slug?: string;
}) {
  const [project] = await db
    .insert(schema.projectTable)
    .values({
      workspaceId,
      name,
      icon,
      slug,
    })
    .returning();

  const insertedColumns: (typeof schema.columnTable.$inferSelect)[] = [];

  for (const col of DEFAULT_PROJECT_COLUMNS) {
    const [inserted] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: col.name,
        slug: col.slug,
        position: col.position,
        isFinal: col.isFinal,
      })
      .returning();
    if (inserted) {
      insertedColumns.push(inserted);
    }
  }

  const columnsBySlug = new Map(
    insertedColumns.map((column) => [column.slug, column]),
  );

  const todo = columnsBySlug.get("to-do");
  const inProgress = columnsBySlug.get("in-progress");
  const inReview = columnsBySlug.get("in-review");
  const done = columnsBySlug.get("done");

  if (!todo || !inProgress || !inReview || !done) {
    throw new Error("Failed to seed default project columns");
  }

  return {
    project,
    columns: {
      todo,
      inProgress,
      inReview,
      done,
    },
  };
}

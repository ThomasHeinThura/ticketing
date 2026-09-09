import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../../../apps/api/src/project/controllers/create-project";

export type SeededMemberContext = {
  user: typeof schema.userTable.$inferSelect;
  workspace: typeof schema.workspaceTable.$inferSelect;
};

/**
 * `drizzle-orm`'s `.returning()` types as `T[]`, and `noUncheckedIndexedAccess` makes
 * `rows[0]` (and array destructuring, which is sugar for the same index access) `T |
 * undefined`. In a seeded integration test that row is always expected to exist — its
 * absence means the insert itself failed — so this throws a clear, attributable error
 * instead of letting every caller re-derive the same "possibly undefined" narrowing, or
 * silently propagate `| undefined` into a type that does not expect it.
 */
export function requireRow<T>(rows: readonly T[], context: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${context}: insert returned no row`);
  }
  return row;
}

export async function createWorkspaceMember(
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
  }>,
): Promise<SeededMemberContext> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;

  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: overrides?.userName || "Integration Test User",
      })
      .returning(),
    "createWorkspaceMember: user",
  );

  const workspace = requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        id: workspaceId,
        createdAt: new Date(),
        name: overrides?.workspaceName || "Integration Test Workspace",
        slug: `workspace-${randomUUID()}`,
      })
      .returning(),
    "createWorkspaceMember: workspace",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: overrides?.role ?? "member",
    joinedAt: new Date(),
  });

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
  const project = requireRow(
    await db
      .insert(schema.projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
      })
      .returning(),
    "createProjectFixture: project",
  );

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

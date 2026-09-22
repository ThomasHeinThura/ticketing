import { eq, max, sql } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable } from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
] as const;

/**
 * #23's mandatory Opus security review of PR #261, finding F1 (decision log 2026-09-22):
 * `project.slug` is now globally unique (migration 0064), because `work_item.key`
 * (`{project.slug}-{number}`) was already assuming that and carries its own global unique
 * index on top of it -- a colliding slug used to permanently 500 the victim project's
 * first work-item create. Mirrors `WorkspaceSlugTakenError`
 * (`workspace/controllers/create-workspace.ts`) exactly: the DB constraint is the
 * backstop, this is the clean error a caller actually gets.
 */
export class ProjectSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Project slug "${slug}" is already taken`);
    this.name = "ProjectSlugTakenError";
  }
}

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
) {
  try {
    return await createProjectRow(workspaceId, name, icon, slug);
  } catch (error) {
    if (isUniqueViolation(error, "slug")) {
      throw new ProjectSlugTakenError(slug);
    }
    throw error;
  }
}

async function createProjectRow(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
) {
  return db.transaction(async (tx) => {
    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. `reorderProjects` takes
    // the same lock with the same key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
    );

    // New projects go to the bottom of the workspace's ordering.
    const [{ maxPosition } = { maxPosition: null }] = await tx
      .select({ maxPosition: max(projectTable.position) })
      .from(projectTable)
      .where(eq(projectTable.workspaceId, workspaceId));

    const [createdProject] = await tx
      .insert(projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
        position: maxPosition === null ? 0 : maxPosition + 1,
      })
      .returning();

    if (createdProject) {
      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          isFinal: col.isFinal,
        });
      }
    }

    return createdProject;
  });
}

export default createProject;

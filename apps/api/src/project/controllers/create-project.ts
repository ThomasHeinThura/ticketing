import { eq, max, sql } from "drizzle-orm";
import db from "../../database";
import {
  columnTable,
  projectSlugClaimTable,
  projectTable,
} from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { seedProjectStates } from "../../utils/seed-project-states";

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
 *
 * Also thrown when a slug is free among LIVE projects but PERMANENTLY claimed in
 * `project_slug_claim` (F1's delta-confirmation review, D1, 2026-09-22) -- see
 * `projectSlugClaimTable`'s own schema.ts comment. Same error, same 409: the caller has no
 * need to know which of the two registries rejected it.
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

    // #261 F1's delta-confirmation (D1): a slug can be free among LIVE projects (so the
    // `project_slug_unique` constraint below would let it through) while still being
    // PERMANENTLY claimed -- by some other project, possibly in a different workspace,
    // possibly long deleted -- because a claim, once made, is never released. Checked
    // here, ahead of the insert, for a clean 409 in the common case; the claim table's own
    // PRIMARY KEY (inserted below) is the real arbiter of the race between this check and
    // the write, same idiom `project_slug_unique` already uses one layer up.
    const [existingClaim] = await tx
      .select({ slug: projectSlugClaimTable.slug })
      .from(projectSlugClaimTable)
      .where(eq(projectSlugClaimTable.slug, slug))
      .limit(1);
    if (existingClaim) {
      throw new ProjectSlugTakenError(slug);
    }

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
      // Claim the slug PERMANENTLY, in the same transaction as the project that just took
      // it -- see `projectSlugClaimTable`'s schema.ts comment for why this never happens
      // via a trigger and never gets undone by a later rename or delete.
      await tx.insert(projectSlugClaimTable).values({
        slug,
        projectId: createdProject.id,
      });

      for (const col of DEFAULT_PROJECT_COLUMNS) {
        await tx.insert(columnTable).values({
          projectId: createdProject.id,
          name: col.name,
          slug: col.slug,
          position: col.position,
          isFinal: col.isFinal,
        });
      }

      // Issue #309 (`projects-and-engagements.md` `PR-17`): seed this project's
      // concrete `state` rows from the workspace's default `state_template`s, in the
      // SAME transaction as the project itself.
      await seedProjectStates(createdProject.id, workspaceId, tx);
    }

    return createdProject;
  });
}

export default createProject;

import { and, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectSlugClaimTable, projectTable } from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { ProjectSlugTakenError } from "./create-project";

async function updateProject(
  id: string,
  name: string,
  icon: string,
  slug: string,
  description: string,
  workspaceId: string,
) {
  // #23's mandatory Opus security review of PR #261, F1's delta-confirmation (D1,
  // 2026-09-22): the claim check and the claim write for the NEW slug now have to commit
  // atomically with the rename itself, or a failure between them could leave the slug
  // permanently claimed by a project that never actually got it (or, worse, leave it
  // unclaimed after a rename that did succeed). Wrapped in a transaction for exactly that
  // reason -- `create-project.ts`'s own create path is the same shape.
  return db.transaction(async (tx) => {
    const [existingProject] = await tx
      .select()
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          // #202: a soft-deleted project is gone for ordinary use during its 30-day
          // recovery window (#187, PR-16), so it cannot be renamed, re-iconed or
          // re-described while "deleted". Same exclusion `get-project.ts` applies.
          isNull(projectTable.deletedAt),
        ),
      );

    const isProjectExisting = Boolean(existingProject);

    if (!isProjectExisting) {
      throw new HTTPException(404, {
        message:
          "Project doesn't exist or doesn't belong to the specified workspace",
      });
    }

    // #23's mandatory Opus security review of PR #261, finding F1: answer a slug collision
    // before attempting the write where we can, so the common case is a clean 409 rather
    // than a caught driver error. Mirrors `update-workspace.ts`'s own pre-check exactly.
    // The catch below still covers the race between this read and the update.
    const [clash] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(and(eq(projectTable.slug, slug), ne(projectTable.id, id)))
      .limit(1);
    if (clash) {
      throw new ProjectSlugTakenError(slug);
    }

    // D1: the new slug can be free among LIVE projects (so the check above passes) while
    // still PERMANENTLY claimed by some other project -- including one that once held this
    // exact slug and renamed away, or whose workspace was hard-deleted. A claim already
    // held by THIS SAME project (i.e. renaming back to a slug it once claimed itself) is
    // not a collision -- the claim table's own guarantee is per-slug, not per-holder, and
    // this project is already its holder of record.
    const [existingClaim] = await tx
      .select({ projectId: projectSlugClaimTable.projectId })
      .from(projectSlugClaimTable)
      .where(eq(projectSlugClaimTable.slug, slug))
      .limit(1);
    if (existingClaim && existingClaim.projectId !== id) {
      throw new ProjectSlugTakenError(slug);
    }

    try {
      const [updatedProject] = await tx
        .update(projectTable)
        .set({
          name,
          icon,
          slug,
          description,
        })
        .where(eq(projectTable.id, id))
        .returning();

      // Claim the new slug PERMANENTLY, same transaction as the rename. Deliberately NOT
      // conditioned on `existingClaim` being absent -- `existingClaim` can only be absent
      // here or already held by THIS project (the check above throws for every other
      // case), so this is a no-op re-claim in the "renaming back to an old slug of its
      // own" case and a genuine first claim otherwise. `ON CONFLICT DO NOTHING` on the
      // claim's own PRIMARY KEY makes both cases safe without a branch.
      //
      // The OLD slug is deliberately left claimed -- see `projectSlugClaimTable`'s
      // schema.ts comment: a claim, once made, is never released, by design.
      if (updatedProject) {
        await tx
          .insert(projectSlugClaimTable)
          .values({ slug, projectId: id })
          .onConflictDoNothing({ target: projectSlugClaimTable.slug });
      }

      return updatedProject;
    } catch (error) {
      if (isUniqueViolation(error, "slug")) {
        throw new ProjectSlugTakenError(slug);
      }
      throw error;
    }
  });
}

export default updateProject;

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

async function reorderProjects(
  workspaceId: string,
  projects: Array<{ id: string; position: number }>,
) {
  const ids = projects.map((project) => project.id);
  const uniqueIds = new Set(ids);

  if (uniqueIds.size !== ids.length) {
    throw new HTTPException(400, {
      message: "Duplicate project ids in reorder payload",
    });
  }

  return db.transaction(async (tx) => {
    // Serialize ordering writes per workspace so a concurrent create (which
    // appends at max(position) + 1) cannot interleave with a renumber.
    // `createProject` takes the same lock with the same key.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1524, hashtext(${workspaceId}))`,
    );

    // The whole workspace, not just the payload: the client only ever sees
    // non-archived projects, so archived ones have to hold their place in the
    // ordering without being sent. Ordering here defines each project's current
    // rank, which is what the renumbering below pins them to.
    // #187: a soft-deleted project never holds a place -- unlike `archivedAt`, it is
    // excluded here the same way `get-projects.ts` excludes it from the list.
    const existing = await tx
      .select({ id: projectTable.id, position: projectTable.position })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .orderBy(
        asc(projectTable.position),
        asc(projectTable.createdAt),
        asc(projectTable.id),
      );

    // Verify ownership of the whole batch before writing anything, so a
    // smuggled foreign id cannot leave the workspace half-renumbered.
    const ownedIds = new Set(existing.map((project) => project.id));
    const foreignId = ids.find((id) => !ownedIds.has(id));

    if (foreignId) {
      // #202: a soft-deleted project fails the ownership check above for the same
      // reason a foreign one does -- `existing` excludes it by design (see the read
      // above). Reporting it as "does not belong to this workspace" is wrong: it does
      // belong here, it is gone (#187, PR-16). Both stay a 400 so the route's declared
      // responses are unchanged; only the message distinguishes them.
      const [softDeletedHere] = await tx
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.id, foreignId),
            eq(projectTable.workspaceId, workspaceId),
            isNotNull(projectTable.deletedAt),
          ),
        )
        .limit(1);

      throw new HTTPException(400, {
        message: softDeletedHere
          ? `Project ${foreignId} is deleted and cannot be reordered`
          : `Project ${foreignId} does not belong to this workspace`,
      });
    }

    // Positions are derived server-side rather than trusted from the client:
    // the payload only expresses a relative order. This keeps stored positions
    // in 0..n-1, so they can't drift out of the integer column's range and
    // can't develop duplicates or gaps.
    const requestedOrder = [...projects]
      .sort((a, b) => a.position - b.position)
      .map((project) => project.id);
    const requestedIds = new Set(requestedOrder);

    // Projects the payload omits keep the rank they already hold, and the
    // payload fills the slots around them in the order it asked for. Appending
    // them instead would sink an archived project to the bottom of the
    // workspace the first time anyone dragged a visible one.
    const requested = requestedOrder[Symbol.iterator]();
    const finalOrder = existing.map((project) =>
      requestedIds.has(project.id)
        ? // Every requested id was matched against `existing` above, so the
          // slots and the payload are the same length and this never falls back.
          (requested.next().value ?? project.id)
        : project.id,
    );

    const currentPositions = new Map(
      existing.map((project) => [project.id, project.position]),
    );

    for (const [position, id] of finalOrder.entries()) {
      if (currentPositions.get(id) === position) continue;

      await tx
        .update(projectTable)
        .set({ position })
        .where(eq(projectTable.id, id));
    }

    return tx.query.projectTable.findMany({
      // #187: same exclusion as the read above -- a soft-deleted project must not
      // reappear in the response either.
      where: and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
      orderBy: [
        asc(projectTable.position),
        asc(projectTable.createdAt),
        asc(projectTable.id),
      ],
    });
  });
}

export default reorderProjects;

import { and, eq, ne } from "drizzle-orm";
import db, { schema } from "../../database";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { WorkspaceSlugTakenError } from "./create-workspace";

export type UpdateWorkspaceInput = {
  name?: string;
  slug?: string;
  logo?: string | null;
  description?: string | null;
};

/**
 * Update a workspace's own fields.
 *
 * `description` is here because the column exists ONLY because the plugin
 * declared it as an `additionalFields` entry (retrofit plan R8) — a
 * replacement route that omitted it would make the field silently read-only.
 *
 * Renaming does NOT re-derive the slug. The slug is part of already-shared
 * URLs, and the inherited route only ever changed it when the caller asked
 * for it explicitly.
 *
 * `workspace` has no `updated_at` column (R8) and adding one is a migration
 * the retrofit plan defers out of P0, so this records no update timestamp.
 */
async function updateWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceInput,
) {
  const values: Partial<typeof schema.workspaceTable.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.slug !== undefined) values.slug = input.slug;
  if (input.logo !== undefined) values.logo = input.logo;
  if (input.description !== undefined) values.description = input.description;

  if (Object.keys(values).length === 0) {
    const [unchanged] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    return unchanged ?? null;
  }

  // Answer a collision before attempting the write where we can, so the
  // common case is a clean 409 rather than a caught driver error. The catch
  // below still covers the race between this read and the update.
  if (typeof input.slug === "string") {
    const [clash] = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(
        and(
          eq(schema.workspaceTable.slug, input.slug),
          ne(schema.workspaceTable.id, workspaceId),
        ),
      )
      .limit(1);
    if (clash) {
      throw new WorkspaceSlugTakenError(input.slug);
    }
  }

  try {
    const [updated] = await db
      .update(schema.workspaceTable)
      .set(values)
      .where(eq(schema.workspaceTable.id, workspaceId))
      .returning();
    return updated ?? null;
  } catch (error) {
    if (isUniqueViolation(error, "slug") && typeof input.slug === "string") {
      throw new WorkspaceSlugTakenError(input.slug);
    }
    throw error;
  }
}

export default updateWorkspace;

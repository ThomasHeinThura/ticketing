import { and, eq, ne } from "drizzle-orm";
import type { AuditRequestContext } from "../../audit/request-context";
import db, { schema } from "../../database";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { WorkspaceSlugTakenError } from "./create-workspace";

export type UpdateWorkspaceInput = {
  name?: string;
  slug?: string;
  logo?: string | null;
  description?: string | null;
};

const WORKSPACE_FIELDS = ["name", "slug", "logo", "description"] as const;

export function changedWorkspaceFields(
  before: UpdateWorkspaceInput,
  after: UpdateWorkspaceInput,
): string[] {
  return WORKSPACE_FIELDS.filter(
    (field) => after[field] !== undefined && after[field] !== before[field],
  );
}

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
 * `workspace` has no `updated_at` column (R8); the audit row supplies the
 * change time without a schema migration.
 */
async function updateWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceInput,
  actor: { userId: string | null; audit: AuditRequestContext },
) {
  const values: Partial<typeof schema.workspaceTable.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.slug !== undefined) values.slug = input.slug;
  if (input.logo !== undefined) values.logo = input.logo;
  if (input.description !== undefined) values.description = input.description;

  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .for("update")
        .limit(1);
      if (!before) return { updated: null, auditFailed: false };
      const changedFields = changedWorkspaceFields(before, input);
      if (!changedFields.length) return { updated: before, auditFailed: false };
      if (typeof input.slug === "string") {
        const [clash] = await tx
          .select({ id: schema.workspaceTable.id })
          .from(schema.workspaceTable)
          .where(
            and(
              eq(schema.workspaceTable.slug, input.slug),
              ne(schema.workspaceTable.id, workspaceId),
            ),
          )
          .limit(1);
        if (clash) throw new WorkspaceSlugTakenError(input.slug);
      }
      const [updated] = await tx
        .update(schema.workspaceTable)
        .set(values)
        .where(eq(schema.workspaceTable.id, workspaceId))
        .returning();
      const auditFailed = updated
        ? await appendAuditSavepoint(tx, {
            actorId: actor.userId,
            actorType: actor.audit.apiKeyId ? "api_key" : "person",
            ...actor.audit,
            workspaceId,
            organisationId: before.organisationId,
            action: "workspace.settings_updated",
            entityType: "workspace",
            entityId: workspaceId,
            after: { changedFields },
          })
        : false;
      return { updated: updated ?? null, auditFailed };
    });
    if (result.auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return result.updated;
  } catch (error) {
    // Exact constraint name, not a substring match on `"slug"` (issue #269) -- see
    // `create-workspace.ts`'s own comment for why `workspace_slug_unique` is the only
    // reachable one here.
    if (
      isUniqueViolation(error, "workspace_slug_unique") &&
      typeof input.slug === "string"
    ) {
      throw new WorkspaceSlugTakenError(input.slug);
    }
    throw error;
  }
}

export default updateWorkspace;

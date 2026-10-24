import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { kbCategoryTable } from "../database/schema-p5-kb";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { categoryDeletionBlockers, deleteCategoryRow } from "./repository";

export const KB_CATEGORY_DELETION_ROUTE =
  "DELETE /api/kb/categories/{id}" as const;

/**
 * Deleting a category is a click-level pending action, refused while articles or
 * sub-categories remain in it (they must be moved first). The refusal is raised at request
 * time and again at approval. Articles are archived, never deleted, so they have no target.
 */
export const kbCategoryDeletionTarget: RegisteredDeletionTarget = {
  targetType: "kb_category",
  routeKey: KB_CATEGORY_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Category not found",
  load: async (tx, id) => {
    const [category] = await tx
      .select()
      .from(kbCategoryTable)
      .where(eq(kbCategoryTable.id, id))
      .for("update")
      .limit(1);
    if (!category) return undefined;
    return {
      id: category.id,
      workspaceId: category.workspaceId,
      projectId: null,
      organisationId: null,
      name: category.name,
      summary: { categoryId: category.id, name: category.name },
      version: registeredDeletionFingerprint(category),
    };
  },
  assertDeletable: async (tx, loaded) => {
    const [category] = await tx
      .select({ id: kbCategoryTable.id })
      .from(kbCategoryTable)
      .where(
        and(
          eq(kbCategoryTable.id, loaded.id),
          eq(kbCategoryTable.workspaceId, loaded.workspaceId),
        ),
      )
      .limit(1);
    if (!category) return;
    const blockers = await categoryDeletionBlockers(tx, loaded.id);
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await deleteCategoryRow(tx, loaded.id, loaded.workspaceId, {
      userId: identity.userId,
      personId: null,
      actorType: "person",
      apiKeyId: null,
    });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};

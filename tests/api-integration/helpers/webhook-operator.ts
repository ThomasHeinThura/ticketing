import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";

/** D-E (12 Nov): system managers see all projects; use a custom role for limited operators. */
export async function assignLimitedWebhookRole(
  userId: string,
  workspaceId: string,
) {
  const key = `webhook-operator-${randomUUID()}`;
  await db.insert(schema.roleTable).values({
    scope: "workspace",
    workspaceId,
    key,
    name: "Project-limited webhook operator",
    rank: BUILT_IN_ROLES.manager.rank,
    capabilities: [...BUILT_IN_ROLES.manager.capabilities],
    isSystem: false,
  });
  await db
    .update(schema.workspaceUserTable)
    .set({ role: key })
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
}

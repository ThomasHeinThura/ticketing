import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";

export async function listProjectCustomers(projectId: string) {
  return db
    .select({
      personId: schema.personTable.id,
      name: schema.personTable.displayName,
      hasAccess: schema.customerProjectAccessTable.projectId,
    })
    .from(schema.projectTable)
    .innerJoin(
      schema.personTable,
      eq(schema.personTable.organisationId, schema.projectTable.organisationId),
    )
    .leftJoin(
      schema.customerProjectAccessTable,
      and(
        eq(schema.customerProjectAccessTable.personId, schema.personTable.id),
        eq(schema.customerProjectAccessTable.projectId, schema.projectTable.id),
      ),
    )
    .where(
      and(
        eq(schema.projectTable.id, projectId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
        eq(schema.personTable.isPlaceholder, false),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .then((rows) =>
      rows.map((row) => ({ ...row, hasAccess: row.hasAccess !== null })),
    );
}

export async function changeProjectCustomerAccess(input: {
  projectId: string;
  workspaceId: string;
  personId: string;
  actorId: string;
  actorPersonId: string;
  granted: boolean;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ organisationId: schema.projectTable.organisationId })
      .from(schema.projectTable)
      .innerJoin(
        schema.personTable,
        eq(
          schema.personTable.organisationId,
          schema.projectTable.organisationId,
        ),
      )
      .where(
        and(
          eq(schema.projectTable.id, input.projectId),
          eq(schema.projectTable.workspaceId, input.workspaceId),
          eq(schema.personTable.id, input.personId),
          eq(schema.personTable.side, "customer"),
          eq(schema.personTable.active, true),
          eq(schema.personTable.isPlaceholder, false),
          isNull(schema.projectTable.deletedAt),
          isNull(schema.projectTable.archivedAt),
        ),
      )
      .for("update", { of: [schema.projectTable, schema.personTable] });
    if (!row || !row.organisationId)
      throw new HTTPException(404, {
        message: "Project or customer not found",
      });
    const changed = input.granted
      ? await tx
          .insert(schema.customerProjectAccessTable)
          .values({
            personId: input.personId,
            projectId: input.projectId,
            grantedBy: input.actorPersonId,
          })
          .onConflictDoNothing()
          .returning()
      : await tx
          .delete(schema.customerProjectAccessTable)
          .where(
            and(
              eq(schema.customerProjectAccessTable.personId, input.personId),
              eq(schema.customerProjectAccessTable.projectId, input.projectId),
            ),
          )
          .returning();
    if (changed.length)
      await appendAuditLog(tx, {
        actorId: input.actorId,
        actorType: "person",
        workspaceId: input.workspaceId,
        organisationId: row.organisationId,
        action: "membership.changed",
        entityType: "membership",
        entityId: input.personId,
        before: {
          scope: "project",
          scopeId: input.projectId,
          granted: !input.granted,
        },
        after: {
          scope: "project",
          scopeId: input.projectId,
          granted: input.granted,
        },
      });
    return { granted: input.granted };
  });
}

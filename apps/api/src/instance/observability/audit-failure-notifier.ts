import { and, eq } from "drizzle-orm";
import db, { schema } from "../../database";
import type { AuditFailureOperation } from "../../observability/metrics.js";

export async function isCurrentInstanceAdmin(userId: string): Promise<boolean> {
  const [admin] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .limit(1);
  return admin !== undefined;
}

/**
 * AU-14 durable alert. Each retry is an independent transaction after the caller's audit
 * savepoint has rolled back. Notifications carry only the finite operation and timestamp.
 */
export async function notifyCurrentInstanceAdminsOfAuditFailure(
  operation: AuditFailureOperation,
  occurredAt = new Date(),
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await db.transaction(async (tx) => {
        const admins = await tx
          .selectDistinct({ userId: schema.userTable.id })
          .from(schema.userTable)
          .innerJoin(
            schema.personTable,
            and(
              eq(schema.personTable.userId, schema.userTable.id),
              eq(schema.personTable.side, "staff"),
              eq(schema.personTable.active, true),
            ),
          )
          .where(eq(schema.userTable.role, "admin"));
        if (admins.length === 0) return;
        await tx.insert(schema.notificationTable).values(
          admins.map(({ userId }) => ({
            userId,
            title: "An audit write failed",
            content: `An audit write failed during ${operation}.`,
            type: "audit_write_failed",
            eventData: { operation, occurredAt: occurredAt.toISOString() },
            resourceId: "singleton",
            resourceType: "instance",
            createdAt: occurredAt,
            updatedAt: occurredAt,
          })),
        );
      });
      return;
    } catch {
      // The second, bounded attempt is useful for transient pool/serialization errors.
      // If it also fails, the metrics/log signal remains the operator's fallback.
    }
  }
}

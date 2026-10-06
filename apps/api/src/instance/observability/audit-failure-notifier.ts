import db, { schema } from "../../database";
import type { AuditFailureOperation } from "../../observability/metrics.js";
import { getCurrentInstanceAdmin, listInstanceAdminUsers } from "./repository";

export async function isCurrentInstanceAdmin(userId: string): Promise<boolean> {
  const [admin] = await getCurrentInstanceAdmin(userId);
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
        const admins = await listInstanceAdminUsers(tx);
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

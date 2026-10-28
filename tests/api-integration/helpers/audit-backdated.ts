import { randomUUID } from "node:crypto";
import { canonicalRowHash, ZERO_HASH } from "@taskdesk/domain";
import {
  insertAuditRow,
  lockAuditChain,
  readAuditChainHeadHash,
} from "../../../apps/api/src/audit/repository";
import db from "../../../apps/api/src/database";

/**
 * Appends a correctly chained `audit_log` row whose `created_at` is `daysAgo` days in the past.
 * The audit-purge retention floor lives inside the database function, so purge tests need real
 * old rows; this writes them the way `appendAuditLog` does, with a valid hash, under the chain
 * lock, using the owner connection.
 */
export async function appendBackdatedAudit(
  daysAgo: number,
  options: { organisationId?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    await lockAuditChain(tx);
    const prevHash = (await readAuditChainHeadHash(tx)) ?? ZERO_HASH;
    const iso = new Date(Date.now() - daysAgo * 86_400_000)
      .toISOString()
      .replace("Z", "000Z");
    const id = randomUUID();
    const entityId = randomUUID();
    const actorId = `actor-${randomUUID()}`;
    const after = { n: 1 };
    const rowHash = canonicalRowHash(
      {
        actorId,
        actorType: "person",
        apiKeyId: null,
        impersonatorId: null,
        actorIp: null,
        userAgent: null,
        traceId: null,
        workspaceId: null,
        action: "role.created",
        entityType: "role",
        entityId,
        before: null,
        after,
        createdAt: iso,
      },
      prevHash,
    );
    const inserted = await insertAuditRow(tx, {
      id,
      actorId,
      actorType: "person",
      apiKeyId: null,
      impersonatorId: null,
      actorIp: null,
      userAgent: null,
      traceId: null,
      workspaceId: null,
      projectId: null,
      organisationId: options.organisationId ?? null,
      action: "role.created",
      entityType: "role",
      entityId,
      beforeJson: null,
      afterJson: JSON.stringify(after),
      createdAtText: iso,
      prevHash,
      rowHash,
    });
    return { id, seq: BigInt(inserted?.seq ?? 0), createdAtIso: iso };
  });
}

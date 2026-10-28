import { sql } from "drizzle-orm";
import type { DbTransaction } from "../events/outbox";

export type PendingActionNotificationContext = {
  id: string;
  requestedByPersonId: string;
  origin: string;
  credentialType: string;
  credentialId: string | null;
  action: string;
  targetType: string;
  targetIds: string[];
  payloadSummary: unknown;
  state: string;
  workspaceId: string | null;
  requesterUserId: string | null;
  requesterActive: boolean;
  requesterSide: string;
  keyName: string | null;
  keyOwnerUserId: string | null;
};

/**
 * The pending action named by a `pending_action.*` event with its requester and, for an
 * API-key request, the requesting key's display name and owning user. Read in the
 * producing transaction, so a just-inserted or just-failed row is visible.
 */
export async function findPendingActionNotificationContext(
  tx: DbTransaction,
  pendingActionId: string,
): Promise<PendingActionNotificationContext | undefined> {
  const result = await tx.execute(sql`
    SELECT pa.id,
           pa.requested_by_person_id AS "requestedByPersonId",
           pa.origin,
           pa.credential_type AS "credentialType",
           pa.credential_id AS "credentialId",
           pa.action,
           pa.target_type AS "targetType",
           pa.target_ids AS "targetIds",
           pa.payload_summary AS "payloadSummary",
           pa.state,
           pa.workspace_id AS "workspaceId",
           p.user_id AS "requesterUserId",
           p.active AS "requesterActive",
           p.side AS "requesterSide",
           k.name AS "keyName",
           k.reference_id AS "keyOwnerUserId"
      FROM pending_action pa
      JOIN person p ON p.id = pa.requested_by_person_id
      LEFT JOIN apikey k
        ON pa.credential_type = 'api_key' AND k.id = pa.credential_id
     WHERE pa.id = ${pendingActionId}
     LIMIT 1
  `);
  return result.rows[0] as PendingActionNotificationContext | undefined;
}

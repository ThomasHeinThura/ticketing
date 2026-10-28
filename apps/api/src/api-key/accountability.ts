import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";

/** AK-7: offboarding transfers accountability, never the service key's frozen authority. */
export async function markServiceKeysForFormerCreator(
  tx: Executor,
  personId: string,
  now: Date,
) {
  const result = await tx.execute<{
    apikey_id: string;
    workspace_id: string;
    requires_review: boolean;
  }>(sql`
    UPDATE api_key k
    SET admin_ownership_transferred_at = COALESCE(k.admin_ownership_transferred_at, ${now}),
        former_creator_at = COALESCE(k.former_creator_at, ${now}),
        reattestation_required_at = CASE
          WHEN EXISTS (SELECT 1 FROM apikey a WHERE a.id = k.apikey_id AND a.enabled = true)
          THEN ${now} ELSE k.reattestation_required_at END,
        accountability_version = k.accountability_version + 1
    WHERE k.workspace_id IS NOT NULL AND k.created_by_person_id = ${personId}
    RETURNING k.apikey_id, k.workspace_id,
      (k.reattestation_required_at IS NOT NULL) AS requires_review
  `);
  for (const key of result.rows) {
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: key.workspace_id,
      action: "api_key.ownership_transferred",
      entityType: "api_key",
      entityId: key.apikey_id,
      after: {
        createdByPersonId: personId,
        ownedByWorkspaceAdmins: true,
        requiresReattestation: key.requires_review,
        reason: "creator_deactivated",
      },
    });
  }
  return result.rows.length;
}

/** Revoke parent credentials before the extension's workspace FK cascade removes metadata. */
export async function revokeWorkspaceServiceKeyCredentials(
  tx: Executor,
  workspaceId: string,
  now = new Date(),
) {
  const result = await tx.execute<{ id: string }>(sql`
    UPDATE apikey a SET enabled = false, updated_at = ${now}
    WHERE a.enabled = true AND a.id IN (
      SELECT k.apikey_id FROM api_key k WHERE k.workspace_id = ${workspaceId}
    ) RETURNING a.id
  `);
  return result.rows.length;
}

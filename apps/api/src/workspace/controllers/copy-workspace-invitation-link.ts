import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import { assertCallerHasCapability } from "../../utils/require-workspace-capability";
import { buildStaffInvitationLink } from "../../utils/send-workspace-invitation-email";

export type CopyWorkspaceInvitationLinkInput = {
  workspaceId: string;
  invitationId: string;
  actorUserId: string;
};

/**
 * Returns the staff workspace invitation accept link and writes an `invitation.link_copied` audit
 * row (actor, invitation id, workspace, `after: { scope: "staff" }` — never the invitee email).
 * Requires `member:invite` at request time and never alters `expiresAt`.
 */
export default async function copyWorkspaceInvitationLink(
  input: CopyWorkspaceInvitationLinkInput,
): Promise<{ link: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    await assertCallerHasCapability(
      input.workspaceId,
      input.actorUserId,
      "member:invite",
      { kind: "session" },
      tx,
    );

    const [row] = await tx
      .select()
      .from(schema.invitationTable)
      .where(
        and(
          eq(schema.invitationTable.id, input.invitationId),
          eq(schema.invitationTable.workspaceId, input.workspaceId),
          eq(schema.invitationTable.scope, "staff"),
        ),
      )
      .for("update")
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Invitation not found" });
    }

    const now = new Date();
    if (row.status !== "pending" || row.expiresAt.getTime() <= now.getTime()) {
      throw new HTTPException(409, {
        message: "Only a pending, unexpired invitation link can be copied",
      });
    }

    await appendAuditLog(tx, {
      actorId: input.actorUserId,
      actorType: "person",
      apiKeyId: null,
      workspaceId: input.workspaceId,
      organisationId: null,
      action: "invitation.link_copied",
      entityType: "invitation",
      entityId: row.id,
      before: null,
      after: { scope: "staff" },
    });

    return {
      link: buildStaffInvitationLink(row.id),
      expiresAt: row.expiresAt,
    };
  });
}

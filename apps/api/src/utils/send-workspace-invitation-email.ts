import { sendWorkspaceInvitationEmail } from "@taskdesk/email";
import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { getInvitationEmailSubject } from "./get-invitation-email-subject";
import { getWorkspaceInvitationEmailCopy } from "./get-workspace-invitation-email-copy";

async function getUserLocale(email: string): Promise<string | null> {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);

  return user?.locale ?? null;
}

export type SendWorkspaceInvitationEmailInput = {
  invitationId: string;
  email: string;
  workspaceName: string;
  inviterName: string;
  inviterEmail: string;
};

/**
 * Sends the workspace-invitation email.
 *
 * BYTE-IDENTICAL link format, on purpose (retrofit plan §3, S6a row: "keep
 * the existing link format... byte-identical"). Outstanding invitations
 * created before this change, and every invitation created after it whether
 * through the still-mounted `organization()` plugin or through the native
 * `POST /api/workspace/{id}/invitations` route below, must all resolve
 * through the same `/invitation/accept/{id}` client route
 * (`apps/web/src/routes/invitation/accept.$inviteId.tsx`).
 *
 * Extracted out of `apps/api/src/auth.ts`'s `sendInvitationEmail` hook (which
 * now delegates here) rather than duplicated, so there is exactly ONE place
 * that builds the link and exactly one place that could ever drift from it --
 * the same reasoning `workspace-member-roles.ts` gives for `workspaceMemberRoles`
 * over a `.limit(1)` read: two independent copies of a rule is how this
 * repository's rules go stale.
 */
export async function sendNativeWorkspaceInvitationEmail(
  input: SendWorkspaceInvitationEmailInput,
): Promise<void> {
  const inviteLink = `${process.env.TASKDESK_AGENT_URL}/invitation/accept/${input.invitationId}`;
  const locale = await getUserLocale(input.email);
  const copy = getWorkspaceInvitationEmailCopy(locale);

  const result = await sendWorkspaceInvitationEmail(
    input.email,
    getInvitationEmailSubject(locale, input.inviterName, input.workspaceName),
    {
      inviterEmail: input.inviterEmail,
      inviterName: input.inviterName,
      workspaceName: input.workspaceName,
      invitationLink: inviteLink,
      to: input.email,
      copy,
    },
  );

  if (result?.success === false && result.reason === "SMTP_NOT_CONFIGURED") {
    console.warn(
      "Invitation created but email not sent due to SMTP not being configured",
    );
  }
}

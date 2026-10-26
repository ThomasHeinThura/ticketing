import {
  resolveSmtpConfiguration,
  sendWorkspaceInvitationEmail,
  type WorkspaceInvitationSendOptions,
} from "@taskdesk/email";
import { getConfiguredCustomerOrigin } from "../auth";
import { findUserLocaleByEmail } from "../utils/access-lookups.repository";
import { getInvitationEmailSubject } from "../utils/get-invitation-email-subject";
import { getWorkspaceInvitationEmailCopy } from "../utils/get-workspace-invitation-email-copy";
import { buildAcceptLink } from "./logic";

export type CustomerInvitationMail = {
  invitationId: string;
  email: string;
  organisationName: string;
  inviterName: string;
  inviterEmail: string;
  /** Shown once, inside the link fragment. Never logged, stored or returned by an API. */
  credential: string;
};

/**
 * Whether the instance has an email provider at all (runtime administration or bootstrap
 * environment). This is the only delivery fact the invitation routes may answer with: it is the
 * same for every address, so it cannot tell a real send from an inert row (CP-22). Never throws.
 */
export async function isEmailProviderConfigured(): Promise<boolean> {
  try {
    return (await resolveSmtpConfiguration()) !== null;
  } catch {
    return false;
  }
}

/**
 * Sends the customer invitation through the existing invitation mailer. The link opens the accept
 * page on the portal host root (`/invite/{id}`, CP-24); the credential rides in the fragment so
 * it never reaches a server log or a Referer header. Returns whether the message was accepted for
 * delivery. The result is for the server-side log and audit trail only: callers must never let
 * it change the response, which reports only whether a provider is configured (CP-22).
 */
export async function sendCustomerInvitationEmail(
  input: CustomerInvitationMail,
  options: WorkspaceInvitationSendOptions = {},
): Promise<boolean | "expired"> {
  try {
    const portalOrigin = getConfiguredCustomerOrigin();
    const user = await findUserLocaleByEmail(input.email);
    const locale = user?.locale ?? null;
    const result = await sendWorkspaceInvitationEmail(
      input.email,
      getInvitationEmailSubject(
        locale,
        input.inviterName,
        input.organisationName,
      ),
      {
        inviterEmail: input.inviterEmail,
        inviterName: input.inviterName,
        workspaceName: input.organisationName,
        invitationLink: buildAcceptLink(
          portalOrigin,
          input.invitationId,
          input.credential,
        ),
        to: input.email,
        copy: getWorkspaceInvitationEmailCopy(locale),
      },
      options,
    );
    if (result?.reason === "NOT_AUTHORIZED") return "expired";
    return result?.success !== false;
  } catch {
    return false;
  }
}

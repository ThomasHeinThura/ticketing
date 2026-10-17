import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Executor } from "../../database/executor";
import { findInvitationRecipientAndStatus } from "../repository";
import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  NotInvitationRecipientError,
} from "./invitation-action-errors";

/** Reclassify a recipient-owned guarded write that matched no invitation row. */
export async function refuseRecipientInvitationTransition(
  identity: ResolvedIdentity,
  invitationId: string,
  executor?: Executor,
): Promise<never> {
  const current = await findInvitationRecipientAndStatus(
    identity,
    invitationId,
    executor,
  );
  if (!current) throw new InvitationNotFoundError();
  if (!current.recipientMatches) throw new NotInvitationRecipientError();
  if (!current.pending) throw new InvitationNotPendingError();

  // The row still appears eligible, but the guarded write matched nothing;
  // fail closed using the existing non-pending response.
  throw new InvitationNotPendingError();
}

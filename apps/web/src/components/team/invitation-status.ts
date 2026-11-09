import type { WorkspaceUserInvitation } from "@/types/workspace-user";

/** Invitations still waiting for an answer (pending, including expired ones). */
export function isPendingInvitation(invitation: WorkspaceUserInvitation) {
  return invitation.status !== "accepted" && invitation.status !== "canceled";
}

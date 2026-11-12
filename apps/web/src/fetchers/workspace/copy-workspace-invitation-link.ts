import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CopiedWorkspaceInvitationLink = {
  link: string;
  expiresAt: string;
};

export async function copyWorkspaceInvitationLink(
  workspaceId: string,
  invitationId: string,
): Promise<CopiedWorkspaceInvitationLink> {
  const response = await apiFetch(
    getApiUrl(
      `/workspace/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/copy-link`,
    ),
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to copy the invitation link"),
    );
  }
  return response.json() as Promise<CopiedWorkspaceInvitationLink>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyWorkspaceInvitationLink } from "@/fetchers/workspace/copy-workspace-invitation-link";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { buildInvitationLink } from "@/lib/invitation-link";
import { toast } from "@/lib/toast";

const COPIED_RESET_MS = 2000;

/**
 * Copy behaviour shared by the invite modal and the members table row menu.
 *
 * `fallbackInput` is optional because the row menu has no input to select; when
 * present and copying failed outright, the text is selected so Ctrl+C works.
 * When `workspaceId` is supplied, the server audit endpoint is called in
 * parallel to record `invitation.link_copied` without delaying the browser's
 * synchronous user-gesture clipboard access.
 */
export function useCopyInvitationLink(workspaceId?: string) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (invitationId: string, fallbackInput?: HTMLInputElement | null) => {
      const link = buildInvitationLink(invitationId);
      if (workspaceId) {
        void copyWorkspaceInvitationLink(workspaceId, invitationId).catch(
          () => {},
        );
      }
      const ok = await copyToClipboard(link);

      if (!ok) {
        fallbackInput?.select();
        toast.error(t("team:invitations.copyFailed"));
        return;
      }

      setCopied(true);
      toast.success(t("team:invitations.linkCopied"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    },
    [t, workspaceId],
  );

  return { copy, copied };
}

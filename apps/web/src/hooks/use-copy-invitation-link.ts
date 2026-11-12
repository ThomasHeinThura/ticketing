import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyWorkspaceInvitationLink } from "@/fetchers/workspace/copy-workspace-invitation-link";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { toast } from "@/lib/toast";

const COPIED_RESET_MS = 2000;

export function copyInvitationErrorKey(
  error: unknown,
  namespace: "team" | "customerInvitations",
): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const prefix =
    namespace === "team" ? "team:invitations" : "customerInvitations:toasts";
  if (status === 401 || status === 403) {
    return `${prefix}.copyErrorForbidden`;
  }
  if (status === 404 || status === 409) {
    return `${prefix}.copyErrorInactive`;
  }
  if (status === 429) {
    return `${prefix}.copyErrorRateLimited`;
  }
  return `${prefix}.copyRequestFailed`;
}

/**
 * Copy behaviour shared by the staff invite result card and the members table row menu.
 *
 * Always awaits the server copy-link endpoint (`POST /api/workspace/{workspaceId}/invitations/{invitationId}/copy-link`)
 * before revealing or copying the link — including for the manual input-selection fallback — so a
 * 403, 409, 429 or failed audit transaction reveals and copies nothing and shows a translated error.
 */
export function useCopyInvitationLink(workspaceId?: string) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [revealedLink, setRevealedLink] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (invitationId: string, fallbackInput?: HTMLInputElement | null) => {
      if (copying) return;
      if (!workspaceId) {
        toast.error(t("team:invitations.copyRequestFailed"));
        return;
      }

      setCopying(true);
      setCopied(false);
      setRevealedLink("");
      if (fallbackInput) fallbackInput.value = "";
      try {
        const { link } = await copyWorkspaceInvitationLink(
          workspaceId,
          invitationId,
        );
        setRevealedLink(link);
        if (fallbackInput) {
          fallbackInput.value = link;
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
      } catch (error) {
        toast.error(t(copyInvitationErrorKey(error, "team")));
      } finally {
        setCopying(false);
      }
    },
    [copying, t, workspaceId],
  );

  return { copy, copied, copying, revealedLink };
}

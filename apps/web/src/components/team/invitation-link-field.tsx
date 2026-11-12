import { Button, Input } from "@taskdesk/ui";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCopyInvitationLink } from "@/hooks/use-copy-invitation-link";

type Props = {
  invitationId: string;
  workspaceId?: string;
};

function InvitationLinkField({ invitationId, workspaceId }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const { copy, copied, copying, revealedLink } =
    useCopyInvitationLink(workspaceId);

  return (
    <div className="flex items-center gap-2">
      <Input
        ref={inputRef}
        value={revealedLink}
        placeholder={t("team:invitations.copyFieldPlaceholder")}
        readOnly
        aria-label={t("team:invitations.linkLabel")}
        className="font-mono text-xs"
        onFocus={(event) => {
          if (event.currentTarget.value) {
            event.currentTarget.select();
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5"
        disabled={copying}
        onClick={() => void copy(invitationId, inputRef.current)}
      >
        {copied ? (
          <CheckIcon
            className="size-3 text-success-foreground"
            aria-hidden="true"
          />
        ) : (
          <CopyIcon className="size-3" aria-hidden="true" />
        )}
        <span aria-live="polite">
          {copying
            ? t("team:invitations.copyingLink")
            : copied
              ? t("team:invitations.linkCopied")
              : t("team:invitations.copyLink")}
        </span>
      </Button>
    </div>
  );
}

export default InvitationLinkField;

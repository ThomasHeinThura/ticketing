import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
} from "@taskdesk/ui";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import InvitationLinkField from "@/components/team/invitation-link-field";
import { copyCustomerInvitationLink } from "@/fetchers/customer-invitation";
import { copyInvitationErrorKey } from "@/hooks/use-copy-invitation-link";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatDateMedium, formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";

const COPIED_RESET_MS = 2000;

type StaffInvitationResultCardProps = {
  kind: "staff";
  invitationId: string;
  workspaceId?: string;
  email: string;
  delivered: boolean;
  expiresAt: string;
};

type CustomerInvitationResultCardProps = {
  kind: "customer";
  invitationId: string;
  workspaceId: string;
  organisationId: string;
  email: string;
  delivered: boolean;
  expiresAt: string;
};

export type InvitationResultCardProps =
  | StaffInvitationResultCardProps
  | CustomerInvitationResultCardProps;

function formatExpiry(expiresAt: string): string {
  if (!expiresAt) return "";
  if (typeof formatDateTime === "function") {
    return formatDateTime(expiresAt);
  }
  if (typeof formatDateMedium === "function") {
    return formatDateMedium(expiresAt);
  }
  return expiresAt;
}

export function InvitationResultCard(props: InvitationResultCardProps) {
  const { t } = useTranslation();
  const [revealedLink, setRevealedLink] = useState("");
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const formattedExpiry = formatExpiry(props.expiresAt);

  const handleCustomerCopy = async () => {
    if (props.kind !== "customer" || copying) return;
    setCopying(true);
    try {
      const { link } = await copyCustomerInvitationLink(
        props.workspaceId,
        props.organisationId,
        props.invitationId,
      );
      setRevealedLink(link);
      if (inputRef.current) {
        inputRef.current.value = link;
      }
      const ok = await copyToClipboard(link);
      if (!ok) {
        inputRef.current?.select();
        toast.error(t("customerInvitations:toasts.copyFailed"));
        return;
      }
      setCopied(true);
      toast.success(t("customerInvitations:toasts.linkCopied"));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch (error) {
      toast.error(t(copyInvitationErrorKey(error, "customerInvitations")));
    } finally {
      setCopying(false);
    }
  };

  const deliveryTitle =
    props.kind === "staff"
      ? props.delivered
        ? t("team:invitations.resultEmailSent")
        : t("team:invitations.resultEmailNotSent")
      : props.delivered
        ? t("customerInvitations:resultCard.emailQueued")
        : t("customerInvitations:resultCard.noEmailProvider");

  const alertVariant =
    props.kind === "staff"
      ? props.delivered
        ? "success"
        : "warning"
      : props.delivered
        ? "info"
        : "warning";

  const validUntilText =
    props.kind === "staff"
      ? t("team:invitations.validUntil", { date: formattedExpiry })
      : t("customerInvitations:resultCard.validUntil", {
          date: formattedExpiry,
        });

  const shareDescription =
    props.kind === "staff"
      ? t("team:inviteModal.shareLinkDescription", { email: props.email })
      : t("customerInvitations:resultCard.shareDescription", {
          email: props.email,
        });

  return (
    <div className="space-y-3">
      <Alert variant={alertVariant}>
        <AlertTitle>{deliveryTitle}</AlertTitle>
        {formattedExpiry ? (
          <AlertDescription>{validUntilText}</AlertDescription>
        ) : null}
      </Alert>
      <p className="text-muted-foreground text-sm">{shareDescription}</p>
      {props.kind === "staff" ? (
        <InvitationLinkField
          invitationId={props.invitationId}
          workspaceId={props.workspaceId}
        />
      ) : (
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
            onClick={() => void handleCustomerCopy()}
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
                  ? t("customerInvitations:actions.copied")
                  : t("customerInvitations:actions.copyLink")}
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}

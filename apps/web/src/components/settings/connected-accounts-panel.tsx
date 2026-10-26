import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  confirmIdentityLink,
  getIdentityLinkIntent,
  getIdentityLinks,
  startIdentityLink,
} from "@/fetchers/identity-links";
import { HttpError } from "@/lib/http-error";

const linksQueryKey = ["identity-links"] as const;

export function identityLinkAuthorizationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid identity provider authorization URL");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Invalid identity provider authorization URL");
  return url.href;
}

export function ConnectedAccountsPanel({
  intentId,
  onClearIntent,
}: {
  intentId?: string;
  onClearIntent: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [startFailed, setStartFailed] = useState(false);
  const [intentFailed, setIntentFailed] = useState(false);
  const [success, setSuccess] = useState<"linked" | "alreadyLinked" | null>(
    null,
  );
  const links = useQuery({
    queryKey: linksQueryKey,
    queryFn: getIdentityLinks,
    retry: false,
  });
  const intent = useQuery({
    queryKey: ["identity-link-intent", intentId],
    queryFn: () => {
      if (!intentId) throw new Error("Missing identity link intent");
      return getIdentityLinkIntent(intentId);
    },
    enabled: Boolean(intentId),
    retry: false,
  });
  const start = useMutation({
    mutationFn: startIdentityLink,
    onSuccess: ({ authorizationUrl }) => {
      try {
        window.location.assign(identityLinkAuthorizationUrl(authorizationUrl));
      } catch {
        setStartFailed(true);
      }
    },
    onError: () => setStartFailed(true),
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (!intentId) throw new Error("Missing identity link intent");
      return confirmIdentityLink(intentId);
    },
    onSuccess: async (result) => {
      setSuccess(result.alreadyLinked ? "alreadyLinked" : "linked");
      onClearIntent();
      await queryClient.invalidateQueries({ queryKey: linksQueryKey });
    },
    onError: () => setIntentFailed(true),
  });

  const handleClearIntent = () => {
    setIntentFailed(false);
    onClearIntent();
  };

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">
            {t("auth:accountSecurity.identityLinks.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("auth:accountSecurity.identityLinks.description")}
          </p>
        </div>

        {success ? (
          <Alert>
            <AlertDescription>
              {t(`auth:accountSecurity.identityLinks.${success}`)}
            </AlertDescription>
          </Alert>
        ) : null}
        {startFailed ? (
          <Alert variant="error">
            <AlertDescription>
              {t("auth:accountSecurity.identityLinks.startError")}
            </AlertDescription>
          </Alert>
        ) : null}

        {links.isPending ? (
          <p role="status">{t("auth:accountSecurity.identityLinks.loading")}</p>
        ) : links.isError ? (
          <Alert variant="info">
            <AlertDescription>
              {links.error instanceof HttpError && links.error.status === 403
                ? t("auth:accountSecurity.identityLinks.passwordSession")
                : t("auth:accountSecurity.identityLinks.loadError")}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium">
                {t("auth:accountSecurity.identityLinks.sourceLabel")}
              </p>
              <p className="text-sm text-muted-foreground">
                {links.data.source.displayName}
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">
                {t("auth:accountSecurity.identityLinks.availableTitle")}
              </p>
              {links.data.targets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("auth:accountSecurity.identityLinks.unavailable")}
                </p>
              ) : (
                links.data.targets.map((target) => (
                  <div
                    key={target.connectionId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <span className="text-sm font-medium">
                      {target.displayName}
                    </span>
                    {target.linked ? (
                      <Badge variant="secondary">
                        {t("auth:accountSecurity.identityLinks.linkedBadge")}
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={start.isPending}
                        onClick={() => {
                          setStartFailed(false);
                          start.mutate(target.connectionId);
                        }}
                      >
                        {t("auth:accountSecurity.identityLinks.linkAction")}
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog
        open={Boolean(intentId)}
        onOpenChange={(open) => {
          if (!open) handleClearIntent();
        }}
      >
        <DialogContent closeLabel={t("common:actions.close")}>
          <DialogHeader>
            <DialogTitle>
              {t("auth:accountSecurity.identityLinks.confirmTitle")}
            </DialogTitle>
            {intent.isPending ? (
              <DialogDescription>
                {t("auth:accountSecurity.identityLinks.loading")}
              </DialogDescription>
            ) : intent.isError || intentFailed ? (
              <DialogDescription>
                {t("auth:accountSecurity.identityLinks.intentError")}
              </DialogDescription>
            ) : intent.data ? (
              <DialogDescription>
                {t("auth:accountSecurity.identityLinks.confirmDescription", {
                  displayName:
                    intent.data.displayName ??
                    intent.data.accountLabel ??
                    intent.data.targetDisplayName,
                  accountLabel:
                    intent.data.accountLabel ??
                    intent.data.displayName ??
                    intent.data.targetDisplayName,
                  targetDisplayName: intent.data.targetDisplayName,
                  sourceDisplayName: intent.data.sourceDisplayName,
                })}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {intent.data ? (
            <p className="text-sm text-muted-foreground">
              {t("auth:accountSecurity.identityLinks.linkPermissionsNote")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClearIntent}
              disabled={confirm.isPending}
            >
              {t("auth:accountSecurity.identityLinks.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!intent.data || intent.isPending || confirm.isPending}
              onClick={() => {
                setIntentFailed(false);
                confirm.mutate();
              }}
            >
              {confirm.isPending
                ? t("auth:accountSecurity.identityLinks.linking")
                : t("auth:accountSecurity.identityLinks.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

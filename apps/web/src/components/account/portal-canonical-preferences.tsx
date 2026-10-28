import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import {
  getPortalCanonicalPreferences,
  getPortalEmailLinkHandoff,
  type PortalCanonicalPreference,
  savePortalCanonicalPreference,
} from "@/fetchers/notification-preferences/portal-canonical-preference";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { consumeNotificationPreferenceHandoffAttempted } from "@/lib/notification-preference-handoff";
import { routes } from "@/lib/routes";

export function PortalCanonicalPreferencesPage({
  portalUserId,
}: {
  portalUserId: string;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const [emailLinkAttempted] = useState(
    consumeNotificationPreferenceHandoffAttempted,
  );
  const preferences = useQuery({
    queryKey: ["portal", portalUserId, "canonical-notification-preferences"],
    queryFn: getPortalCanonicalPreferences,
  });
  const handoff = useQuery({
    queryKey: ["portal", portalUserId, "notification-preference-handoff"],
    queryFn: getPortalEmailLinkHandoff,
    retry: false,
    staleTime: 0,
  });
  const selector = handoff.data;
  const supported = Boolean(
    selector &&
      (selector.eventKind === "work_item.mentioned" ||
        selector.eventKind === "work_item.commented") &&
      selector.channel === "notify.email" &&
      selector.scope === "global" &&
      selector.scopeId === null,
  );
  const mentionTarget = useRef<HTMLDivElement>(null);
  const commentTarget = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (supported && !preferences.isLoading) {
      const target =
        selector?.eventKind === "work_item.commented"
          ? commentTarget.current
          : mentionTarget.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "center" });
    }
  }, [supported, preferences.isLoading, selector?.eventKind]);

  const mention = preferences.data?.find(
    (value) => value.eventKind === "work_item.mentioned",
  );
  const comment = preferences.data?.find(
    (value) => value.eventKind === "work_item.commented",
  );
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-semibold">
          {t("portal:account.notifications.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.description")}
        </p>
      </header>
      <p className="text-sm text-muted-foreground">
        <Link
          className="underline underline-offset-4"
          to={routes.portalRequests.path}
        >
          {t("portal:account.notifications.requestsLink")}
        </Link>
      </p>
      {preferences.isError ? (
        <Alert variant="error">
          <AlertTitle>
            {t("portal:account.notifications.unavailable")}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{t("portal:account.notifications.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void preferences.refetch()}
            >
              {t("common:actions.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : preferences.isLoading || !mention || !comment ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {selector && !supported ? (
            <Alert>
              <AlertDescription>
                {t("portal:account.notifications.unsupported")}
              </AlertDescription>
            </Alert>
          ) : null}
          {emailLinkAttempted && !supported && !handoff.isLoading ? (
            <Alert>
              <AlertDescription>
                {t("portal:account.notifications.invalidLink")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div
            ref={mentionTarget}
            tabIndex={-1}
            className={
              supported && selector?.eventKind === "work_item.mentioned"
                ? "rounded-lg ring-2 ring-ring"
                : undefined
            }
          >
            <PreferenceCard
              preference={mention}
              kind="mention"
              portalUserId={portalUserId}
            />
          </div>
          <div
            ref={commentTarget}
            tabIndex={-1}
            className={
              supported && selector?.eventKind === "work_item.commented"
                ? "rounded-lg ring-2 ring-ring"
                : undefined
            }
          >
            <PreferenceCard
              preference={comment}
              kind="comment"
              portalUserId={portalUserId}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function PreferenceCard({
  preference,
  kind,
  portalUserId,
}: {
  preference: PortalCanonicalPreference;
  kind: "mention" | "comment";
  portalUserId: string;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [digest, setDigest] = useState(preference.digest);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({ mutationFn: savePortalCanonicalPreference });
  const title = t(`portal:account.notifications.${kind}.title`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t(`portal:account.notifications.${kind}.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id={`portal-${kind}-email-enabled`}
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(value) => {
              setEnabled(value);
              setSaved(false);
            }}
          />
          <Label htmlFor={`portal-${kind}-email-enabled`}>
            {t(`portal:account.notifications.${kind}.enabled`)}
          </Label>
        </div>
        {kind === "comment" ? (
          <div className="space-y-2">
            <Label htmlFor="portal-comment-email-digest">
              {t("portal:account.notifications.comment.digest")}
            </Label>
            <Select
              value={digest}
              onValueChange={(value) => {
                if (
                  value === "off" ||
                  value === "hourly" ||
                  value === "daily"
                ) {
                  setDigest(value);
                  setSaved(false);
                }
              }}
              disabled={mutation.isPending || !enabled}
            >
              <SelectTrigger id="portal-comment-email-digest">
                <SelectValue>
                  {t(
                    `portal:account.notifications.comment.digestCadence.${digest}`,
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">
                  {t("portal:account.notifications.comment.digestCadence.off")}
                </SelectItem>
                <SelectItem value="hourly">
                  {t(
                    "portal:account.notifications.comment.digestCadence.hourly",
                  )}
                </SelectItem>
                <SelectItem value="daily">
                  {t(
                    "portal:account.notifications.comment.digestCadence.daily",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("portal:account.notifications.mention.urgent")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.providerRequired")}
        </p>
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("portal:account.notifications.saveFailed")}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-sm">
            {t("portal:account.notifications.saved")}
          </p>
        ) : null}
        <Button
          type="button"
          disabled={
            mutation.isPending ||
            (enabled === preference.enabled && digest === preference.digest)
          }
          onClick={() =>
            mutation.mutate(
              { eventKind: preference.eventKind, enabled, digest },
              {
                onSuccess: async () => {
                  await queryClient.invalidateQueries({
                    queryKey: [
                      "portal",
                      portalUserId,
                      "canonical-notification-preferences",
                    ],
                  });
                  setSaved(true);
                },
              },
            )
          }
        >
          {t("portal:account.notifications.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

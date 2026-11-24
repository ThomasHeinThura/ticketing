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
  LoadingStatus,
  PageContainer,
  SAVE_FEEDBACK_HOLD_MS,
  SaveButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  useDelayedPending,
} from "@taskdesk/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  getPortalCanonicalPreferences,
  getPortalEmailLinkHandoff,
  getPortalQuietHours,
  type PortalCanonicalPreference,
  savePortalCanonicalPreference,
  savePortalQuietHours,
} from "@/fetchers/notification-preferences/portal-canonical-preference";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { consumeNotificationPreferenceHandoffAttempted } from "@/lib/notification-preference-handoff";
import { portalRouteBuilders } from "@/lib/portal-route-builders";
import { QuietHoursForm } from "./quiet-hours-preference";

const PREFERENCE_CARDS = [
  { eventKind: "work_item.mentioned", kind: "mention", urgent: true },
  { eventKind: "work_item.commented", kind: "comment", urgent: false },
  { eventKind: "work_item.transitioned", kind: "transition", urgent: false },
  { eventKind: "submission.replied", kind: "requestReply", urgent: false },
  { eventKind: "submission.declined", kind: "requestDeclined", urgent: false },
  { eventKind: "submission.accepted", kind: "requestAccepted", urgent: false },
  { eventKind: "approval.requested", kind: "approvalRequested", urgent: false },
  { eventKind: "approval.expiring", kind: "approvalExpiring", urgent: true },
  { eventKind: "approval.withdrawn", kind: "approvalWithdrawn", urgent: false },
] as const;

export function PortalCanonicalPreferencesPage({
  portalUserId,
  history,
}: {
  portalUserId: string;
  history?: ReactNode;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const [emailLinkAttempted] = useState(
    consumeNotificationPreferenceHandoffAttempted,
  );
  const preferences = useQuery({
    queryKey: ["portal", portalUserId, "canonical-notification-preferences"],
    queryFn: getPortalCanonicalPreferences,
  });
  const placeholderVisible = useDelayedPending(preferences.isLoading);
  const handoff = useQuery({
    queryKey: ["portal", portalUserId, "notification-preference-handoff"],
    queryFn: getPortalEmailLinkHandoff,
    retry: false,
    staleTime: 0,
  });
  const selector = handoff.data;
  const supported = Boolean(
    selector &&
      PREFERENCE_CARDS.some((card) => card.eventKind === selector.eventKind) &&
      selector.channel === "notify.email" &&
      selector.scope === "global" &&
      selector.scopeId === null,
  );
  const targets = useRef<Record<string, HTMLDivElement | null>>({});
  const complete = PREFERENCE_CARDS.every((card) =>
    preferences.data?.some((row) => row.eventKind === card.eventKind),
  );
  useEffect(() => {
    if (
      supported &&
      complete &&
      !preferences.isLoading &&
      !placeholderVisible &&
      selector
    ) {
      const target = targets.current[selector.eventKind];
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "center" });
    }
  }, [
    supported,
    complete,
    preferences.isLoading,
    placeholderVisible,
    selector,
  ]);
  return (
    <PageContainer scroll={false} gutter="default" width="4xl">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-semibold">
          {t("portal:account.notifications.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.inAppAlways")}
        </p>
      </header>
      {history}
      <p className="text-sm text-muted-foreground">
        <Link
          className="underline underline-offset-4"
          to={portalRouteBuilders.portalRequests.path}
        >
          {t("portal:account.notifications.requestsLink")}
        </Link>
      </p>
      {preferences.isError || (!preferences.isLoading && !complete) ? (
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
      ) : preferences.isLoading || placeholderVisible ? (
        <LoadingStatus
          visible={placeholderVisible}
          label={t("common:empty.loading")}
        >
          <Card>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </LoadingStatus>
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
          {PREFERENCE_CARDS.map((definition) => {
            const preference = preferences.data?.find(
              (row) => row.eventKind === definition.eventKind,
            );
            if (!preference) return null;
            return (
              <div
                key={`${portalUserId}:${definition.eventKind}`}
                data-event-kind={definition.eventKind}
                ref={(node) => {
                  targets.current[definition.eventKind] = node;
                }}
                tabIndex={-1}
                className={
                  supported && selector?.eventKind === definition.eventKind
                    ? "rounded-lg ring-2 ring-ring"
                    : undefined
                }
              >
                <PreferenceCard
                  preference={preference}
                  kind={definition.kind}
                  urgent={definition.urgent}
                  portalUserId={portalUserId}
                />
              </div>
            );
          })}
        </div>
      )}
      <PortalQuietHoursPreference portalUserId={portalUserId} />
    </PageContainer>
  );
}

function PortalQuietHoursPreference({
  portalUserId,
}: {
  portalUserId: string;
}) {
  const { t } = usePortalTranslation([
    "portal",
    "notificationProvider",
    "common",
  ]);
  const cacheKey = ["portal", portalUserId, "canonical-quiet-hours"] as const;
  const preferences = useQuery({
    queryKey: cacheKey,
    queryFn: getPortalQuietHours,
  });
  const placeholderVisible = useDelayedPending(preferences.isLoading);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (!completed) return;
    const timer = setTimeout(() => setCompleted(false), SAVE_FEEDBACK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [completed]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notificationProvider:quietHours.title")}</CardTitle>
        <CardDescription>
          {t("portal:account.notifications.quietHoursDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences.isError ? (
          <Alert variant="error">
            <AlertDescription>
              {t("notificationProvider:quietHours.unavailable")}
            </AlertDescription>
            <Button
              variant="outline"
              onClick={() => void preferences.refetch()}
            >
              {t("common:actions.tryAgain")}
            </Button>
          </Alert>
        ) : preferences.isLoading || placeholderVisible ? (
          <LoadingStatus
            visible={placeholderVisible}
            label={t("common:empty.loading")}
          >
            <Skeleton className="h-12 w-full" />
          </LoadingStatus>
        ) : (
          <QuietHoursForm
            key={`${portalUserId}:${JSON.stringify(preferences.data)}`}
            saved={preferences.data ?? null}
            completed={completed}
            onStart={() => setCompleted(false)}
            onSaved={() => setCompleted(true)}
            save={savePortalQuietHours}
            historyAudience="portal"
            cacheKey={cacheKey}
            note={t("portal:account.notifications.quietHoursNote")}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PreferenceCard({
  preference,
  kind,
  urgent,
  portalUserId,
}: {
  preference: PortalCanonicalPreference;
  kind: (typeof PREFERENCE_CARDS)[number]["kind"];
  urgent: boolean;
  portalUserId: string;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [digest, setDigest] = useState(preference.digest);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof savePortalCanonicalPreference>[0]) =>
      savePortalCanonicalPreference(input),
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "portal", section: "notifications" },
        ],
      },
    },
  });
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
        {!urgent ? (
          <div className="space-y-2">
            <Label htmlFor={`portal-${kind}-email-digest`}>
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
              <SelectTrigger id={`portal-${kind}-email-digest`}>
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
            {t(`portal:account.notifications.${kind}.urgent`)}
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
        <p role="status" className="text-sm">
          {saved ? t("portal:account.notifications.saved") : null}
        </p>
        <SaveButton
          type="button"
          pending={mutation.isPending}
          success={saved}
          savedLabel={t("common:actions.saved")}
          workingLabel={t("common:actions.saving")}
          announceSuccess={false}
          disabled={
            !mutation.isPending &&
            enabled === preference.enabled &&
            digest === preference.digest
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
        </SaveButton>
      </CardContent>
    </Card>
  );
}

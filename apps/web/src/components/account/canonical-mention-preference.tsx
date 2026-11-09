import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
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
import { useTranslation } from "react-i18next";
import {
  getEmailLinkHandoff,
  type CanonicalMentionPreference as Preference,
  saveCommentEmailPreference,
  saveMentionEmailPreference,
  saveTeamNotificationEmailPreference,
} from "@/fetchers/notification-preferences/canonical-mention-preference";
import useGetNotificationPreferences from "@/hooks/queries/notification-preferences/use-get-notification-preferences";

export function CanonicalMentionPreference() {
  const { t } = useTranslation("notificationProvider");
  const preferences = useGetNotificationPreferences();
  const handoff = useQuery({
    queryKey: ["notification-preferences", "email-link-handoff"],
    queryFn: getEmailLinkHandoff,
    retry: false,
    staleTime: 0,
  });
  const mentionTarget = useRef<HTMLDivElement>(null);
  const commentTarget = useRef<HTMLDivElement>(null);
  const teamNotificationTarget = useRef<HTMLDivElement>(null);
  const selector = handoff.data;
  const supportedHandoff = Boolean(
    selector &&
      (selector.eventKind === "work_item.mentioned" ||
        selector.eventKind === "work_item.commented" ||
        selector.eventKind === "automation.notification_sent") &&
      selector.channel === "notify.email" &&
      selector.scope === "global" &&
      selector.scopeId === null,
  );
  useEffect(() => {
    if (supportedHandoff && !preferences.isLoading) {
      const target =
        selector?.eventKind === "work_item.commented"
          ? commentTarget.current
          : selector?.eventKind === "automation.notification_sent"
            ? teamNotificationTarget.current
            : mentionTarget.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView?.({ block: "center" });
    }
  }, [supportedHandoff, preferences.isLoading, selector?.eventKind]);
  const preference = preferences.data?.canonicalPreferences?.find(
    (row) =>
      row.eventKind === "work_item.mentioned" &&
      row.channel === "notify.email" &&
      row.scope === "global" &&
      row.scopeId === null,
  );
  const commentPreference = preferences.data?.canonicalPreferences?.find(
    (row) =>
      row.eventKind === "work_item.commented" &&
      row.channel === "notify.email" &&
      row.scope === "global" &&
      row.scopeId === null,
  );
  const teamNotificationPreference =
    preferences.data?.canonicalPreferences?.find(
      (row) =>
        row.eventKind === "automation.notification_sent" &&
        row.channel === "notify.email" &&
        row.scope === "global" &&
        row.scopeId === null,
    );
  return (
    <div className="space-y-4">
      {/* S6: one note for every email preference below, not one per card. */}
      <p className="text-sm text-muted-foreground">
        {t("mention.providerRequired")}
      </p>
      <div
        ref={mentionTarget}
        tabIndex={-1}
        className={
          supportedHandoff && selector?.eventKind === "work_item.mentioned"
            ? "rounded-lg ring-2 ring-ring"
            : undefined
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("mention.title")}</CardTitle>
            <CardDescription>{t("mention.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selector &&
              !supportedHandoff &&
              selector.eventKind !== "report.export_ready" && (
                <Alert>
                  <AlertDescription>
                    {t("mention.unsupported")}
                  </AlertDescription>
                </Alert>
              )}
            {handoff.isError && (
              <Alert>
                <AlertDescription>
                  {t("mention.linkUnavailable")}
                </AlertDescription>
              </Alert>
            )}
            {preferences.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : preferences.isError || !preference ? (
              <Alert variant="error">
                <AlertDescription>{t("mention.unavailable")}</AlertDescription>
                <Button
                  variant="outline"
                  onClick={() => void preferences.refetch()}
                >
                  {t("retry")}
                </Button>
              </Alert>
            ) : (
              <MentionEmailForm
                key={`${preference.source}:${preference.enabled}:${preference.digest}`}
                preference={preference}
                kind="mention"
              />
            )}
          </CardContent>
        </Card>
      </div>
      <div
        ref={teamNotificationTarget}
        tabIndex={-1}
        className={
          supportedHandoff &&
          selector?.eventKind === "automation.notification_sent"
            ? "rounded-lg ring-2 ring-ring"
            : undefined
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("teamNotification.title")}</CardTitle>
            <CardDescription>
              {t("teamNotification.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preferences.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : preferences.isError || !teamNotificationPreference ? (
              <Alert variant="error">
                <AlertDescription>{t("mention.unavailable")}</AlertDescription>
              </Alert>
            ) : (
              <MentionEmailForm
                key={`${teamNotificationPreference.source}:${teamNotificationPreference.enabled}:${teamNotificationPreference.digest}`}
                preference={teamNotificationPreference}
                kind="teamNotification"
              />
            )}
          </CardContent>
        </Card>
      </div>
      <div
        ref={commentTarget}
        tabIndex={-1}
        className={
          supportedHandoff && selector?.eventKind === "work_item.commented"
            ? "rounded-lg ring-2 ring-ring"
            : undefined
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("comment.title")}</CardTitle>
            <CardDescription>{t("comment.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {preferences.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : preferences.isError || !commentPreference ? (
              <Alert variant="error">
                <AlertDescription>{t("mention.unavailable")}</AlertDescription>
              </Alert>
            ) : (
              <MentionEmailForm
                key={`${commentPreference.source}:${commentPreference.enabled}:${commentPreference.digest}`}
                preference={commentPreference}
                kind="comment"
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
/**
 * One email preference that saves as soon as it changes (S6): the switch and the digest cadence
 * each save the pair; a failed save puts the previous values back and says so.
 */
function MentionEmailForm({
  preference,
  kind,
}: {
  preference: Preference;
  kind: "mention" | "comment" | "teamNotification";
}) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [digest, setDigest] = useState(preference.digest);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const savePreference =
    preference.eventKind === "work_item.commented"
      ? saveCommentEmailPreference
      : preference.eventKind === "automation.notification_sent"
        ? saveTeamNotificationEmailPreference
        : saveMentionEmailPreference;
  const mutation = useMutation({ mutationFn: savePreference });
  const save = (next: { enabled: boolean; digest: Preference["digest"] }) => {
    const previous = { enabled, digest };
    setEnabled(next.enabled);
    setDigest(next.digest);
    setNotice(null);
    setFailed(false);
    mutation.mutate(next, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: ["notification-preferences"],
        });
        if (mounted.current) setNotice(t(`${kind}.saved`));
      },
      onError: () => {
        if (!mounted.current) return;
        setEnabled(previous.enabled);
        setDigest(previous.digest);
        setFailed(true);
      },
    });
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch
          id={`${kind}-email-enabled`}
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(value) => save({ enabled: value, digest })}
        />
        <Label htmlFor={`${kind}-email-enabled`}>{t(`${kind}.enabled`)}</Label>
      </div>
      {kind !== "mention" ? (
        <div className="space-y-2">
          <Label htmlFor={`${kind}-email-digest`}>{t(`${kind}.digest`)}</Label>
          <Select
            value={digest}
            onValueChange={(value) => {
              if (
                (value === "off" || value === "hourly" || value === "daily") &&
                value !== digest
              ) {
                save({ enabled, digest: value });
              }
            }}
            disabled={mutation.isPending || !enabled}
          >
            <SelectTrigger className="sm:w-56" id={`${kind}-email-digest`}>
              <SelectValue>{t(`${kind}.digestCadence.${digest}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">
                {t(`${kind}.digestCadence.off`)}
              </SelectItem>
              <SelectItem value="hourly">
                {t(`${kind}.digestCadence.hourly`)}
              </SelectItem>
              <SelectItem value="daily">
                {t(`${kind}.digestCadence.daily`)}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("mention.urgentBypass")}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t(`${kind}.saveFailed`)}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </div>
  );
}

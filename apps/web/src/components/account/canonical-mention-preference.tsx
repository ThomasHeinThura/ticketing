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
  SaveButton,
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

type PreferenceKind = "mention" | "comment" | "teamNotification";

export function CanonicalMentionPreference() {
  const { t } = useTranslation("notificationProvider");
  const preferences = useGetNotificationPreferences();
  const [notices, setNotices] = useState<Record<PreferenceKind, string | null>>(
    {
      mention: null,
      comment: null,
      teamNotification: null,
    },
  );
  const [announcement, setAnnouncement] = useState<{
    kind: PreferenceKind;
    message: string;
  } | null>(null);
  function updateNotice(kind: PreferenceKind, message: string | null) {
    setNotices((current) => ({ ...current, [kind]: message }));
    setAnnouncement((current) =>
      message ? { kind, message } : current?.kind === kind ? null : current,
    );
  }
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
      <span className="sr-only" role="status" aria-atomic="true">
        {announcement?.message ?? ""}
      </span>
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
                notice={notices.mention}
                onNotice={(message) => updateNotice("mention", message)}
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
                notice={notices.teamNotification}
                onNotice={(message) =>
                  updateNotice("teamNotification", message)
                }
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
                notice={notices.comment}
                onNotice={(message) => updateNotice("comment", message)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
function MentionEmailForm({
  preference,
  kind,
  notice,
  onNotice,
}: {
  preference: Preference;
  kind: PreferenceKind;
  notice: string | null;
  onNotice: (message: string | null) => void;
}) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [digest, setDigest] = useState(preference.digest);
  const savePreference =
    preference.eventKind === "work_item.commented"
      ? saveCommentEmailPreference
      : preference.eventKind === "automation.notification_sent"
        ? saveTeamNotificationEmailPreference
        : saveMentionEmailPreference;
  const mutation = useMutation({ mutationFn: savePreference });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (mutation.isPending) return;
        mutation.mutate(
          { enabled, digest },
          {
            onSuccess: async () => {
              await queryClient.invalidateQueries({
                queryKey: ["notification-preferences"],
              });
              onNotice(t(`${kind}.saved`));
            },
          },
        );
      }}
    >
      <div className="flex items-center gap-3">
        <Switch
          id={`${kind}-email-enabled`}
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(value) => {
            setEnabled(value);
            onNotice(null);
          }}
        />
        <Label htmlFor={`${kind}-email-enabled`}>{t(`${kind}.enabled`)}</Label>
      </div>
      {kind !== "mention" ? (
        <div className="space-y-2">
          <Label htmlFor={`${kind}-email-digest`}>{t(`${kind}.digest`)}</Label>
          <Select
            value={digest}
            onValueChange={(value) => {
              if (value === "off" || value === "hourly" || value === "daily") {
                setDigest(value);
                onNotice(null);
              }
            }}
            disabled={mutation.isPending || !enabled}
          >
            <SelectTrigger id={`${kind}-email-digest`}>
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
      <p className="text-sm text-muted-foreground">
        {t("mention.providerRequired")}
      </p>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(`${kind}.saveFailed`)}
        </p>
      )}
      {notice && <p className="text-sm">{notice}</p>}
      <SaveButton
        type="submit"
        pending={mutation.isPending}
        success={mutation.isSuccess}
        savedLabel={t("common:actions.saved")}
        workingLabel={t("common:actions.saving")}
        announceSuccess={false}
        disabled={
          !mutation.isPending &&
          enabled === preference.enabled &&
          digest === preference.digest
        }
      >
        {t(`${kind}.save`)}
      </SaveButton>
    </form>
  );
}

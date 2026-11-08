import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardFooter,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  getPortalCanonicalPreferences,
  getPortalEmailLinkHandoff,
  type PortalCanonicalPreference,
  savePortalCanonicalPreference,
} from "@/fetchers/notification-preferences/portal-canonical-preference";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { consumeNotificationPreferenceHandoffAttempted } from "@/lib/notification-preference-handoff";

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-semibold">
          {t("portal:account.notifications.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.description")}
        </p>
      </header>
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
          <PreferencesForm
            mention={mention}
            comment={comment}
            portalUserId={portalUserId}
            mentionTarget={mentionTarget}
            commentTarget={commentTarget}
            highlighted={supported ? selector?.eventKind : undefined}
          />
        </div>
      )}
    </div>
  );
}

type Draft = Pick<PortalCanonicalPreference, "enabled" | "digest">;

function changed(preference: PortalCanonicalPreference, draft: Draft) {
  return (
    draft.enabled !== preference.enabled || draft.digest !== preference.digest
  );
}

/**
 * Both email preferences in one card with one Save (CP-5). Save sends only the preferences that
 * changed; one that fails keeps its edit, so Save can try it again. The email-link handoff still
 * focuses and rings the preference the link named.
 */
function PreferencesForm({
  mention,
  comment,
  portalUserId,
  mentionTarget,
  commentTarget,
  highlighted,
}: {
  mention: PortalCanonicalPreference;
  comment: PortalCanonicalPreference;
  portalUserId: string;
  mentionTarget: RefObject<HTMLDivElement | null>;
  commentTarget: RefObject<HTMLDivElement | null>;
  /** The event kind a verified email link points at. */
  highlighted?: string;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const queryClient = useQueryClient();
  const [mentionDraft, setMentionDraft] = useState<Draft>({
    enabled: mention.enabled,
    digest: mention.digest,
  });
  const [commentDraft, setCommentDraft] = useState<Draft>({
    enabled: comment.enabled,
    digest: comment.digest,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({ mutationFn: savePortalCanonicalPreference });
  const pending = [
    { preference: mention, draft: mentionDraft },
    { preference: comment, draft: commentDraft },
  ].filter(({ preference, draft }) => changed(preference, draft));
  const edit = () => {
    setSaved(false);
    setFailed(false);
  };

  async function save() {
    setSaving(true);
    edit();
    const results = await Promise.allSettled(
      pending.map(({ preference, draft }) =>
        mutation.mutateAsync({ eventKind: preference.eventKind, ...draft }),
      ),
    );
    await queryClient.invalidateQueries({
      queryKey: ["portal", portalUserId, "canonical-notification-preferences"],
    });
    const anyFailed = results.some((result) => result.status === "rejected");
    setFailed(anyFailed);
    setSaved(!anyFailed);
    setSaving(false);
  }

  const ring = (kind: string) =>
    highlighted === kind ? "rounded-lg ring-2 ring-ring" : undefined;
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div
          ref={mentionTarget}
          tabIndex={-1}
          className={ring("work_item.mentioned")}
        >
          <PreferenceSection
            kind="mention"
            draft={mentionDraft}
            disabled={saving}
            onChange={(next) => {
              setMentionDraft(next);
              edit();
            }}
          />
        </div>
        <Separator />
        <div
          ref={commentTarget}
          tabIndex={-1}
          className={ring("work_item.commented")}
        >
          <PreferenceSection
            kind="comment"
            draft={commentDraft}
            disabled={saving}
            onChange={(next) => {
              setCommentDraft(next);
              edit();
            }}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t("portal:account.notifications.providerRequired")}
          </p>
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t("portal:account.notifications.saveFailed")}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              {t("portal:account.notifications.saved")}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          disabled={saving || pending.length === 0}
          onClick={() => void save()}
        >
          {t("portal:account.notifications.save")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PreferenceSection({
  kind,
  draft,
  disabled,
  onChange,
}: {
  kind: "mention" | "comment";
  draft: Draft;
  disabled: boolean;
  onChange: (draft: Draft) => void;
}) {
  const { t } = usePortalTranslation(["portal", "common"]);
  const { enabled, digest } = draft;
  return (
    <section
      aria-labelledby={`portal-${kind}-preference-title`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`portal-${kind}-preference-title`}
          className="font-semibold text-base"
        >
          {t(`portal:account.notifications.${kind}.title`)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(`portal:account.notifications.${kind}.description`)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          id={`portal-${kind}-email-enabled`}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(value) => onChange({ ...draft, enabled: value })}
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
              if (value === "off" || value === "hourly" || value === "daily")
                onChange({ ...draft, digest: value });
            }}
            disabled={disabled || !enabled}
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
                {t("portal:account.notifications.comment.digestCadence.hourly")}
              </SelectItem>
              <SelectItem value="daily">
                {t("portal:account.notifications.comment.digestCadence.daily")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("portal:account.notifications.mention.urgent")}
        </p>
      )}
    </section>
  );
}

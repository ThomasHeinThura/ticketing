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
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getEmailLinkHandoff,
  type CanonicalMentionPreference as Preference,
  saveMentionEmailPreference,
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
  const target = useRef<HTMLDivElement>(null);
  const selector = handoff.data;
  const matches = Boolean(
    selector &&
      selector.eventKind === "work_item.mentioned" &&
      selector.channel === "notify.email" &&
      selector.scope === "global" &&
      selector.scopeId === null,
  );
  useEffect(() => {
    if (matches && !preferences.isLoading) {
      target.current?.focus({ preventScroll: true });
      target.current?.scrollIntoView?.({ block: "center" });
    }
  }, [matches, preferences.isLoading]);
  const preference = preferences.data?.canonicalPreferences?.find(
    (row) =>
      row.eventKind === "work_item.mentioned" &&
      row.channel === "notify.email" &&
      row.scope === "global" &&
      row.scopeId === null,
  );
  return (
    <div
      ref={target}
      tabIndex={-1}
      className={matches ? "rounded-lg ring-2 ring-ring" : undefined}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("mention.title")}</CardTitle>
          <CardDescription>{t("mention.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selector && !matches && (
            <Alert>
              <AlertDescription>{t("mention.unsupported")}</AlertDescription>
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
              key={`${preference.source}:${preference.enabled}`}
              preference={preference}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function MentionEmailForm({ preference }: { preference: Preference }) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(preference.enabled);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutation = useMutation({ mutationFn: saveMentionEmailPreference });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(enabled, {
          onSuccess: async () => {
            await queryClient.invalidateQueries({
              queryKey: ["notification-preferences"],
            });
            if (mounted.current) setNotice(t("mention.saved"));
          },
        });
      }}
    >
      <div className="flex items-center gap-3">
        <Switch
          id="mention-email-enabled"
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(value) => {
            setEnabled(value);
            setNotice(null);
          }}
        />
        <Label htmlFor="mention-email-enabled">{t("mention.enabled")}</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("mention.providerRequired")}
      </p>
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("mention.saveFailed")}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <Button
        type="submit"
        disabled={mutation.isPending || enabled === preference.enabled}
      >
        {t("mention.save")}
      </Button>
    </form>
  );
}

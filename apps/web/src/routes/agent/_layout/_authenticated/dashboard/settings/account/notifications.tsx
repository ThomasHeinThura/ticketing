import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CanonicalMentionPreference } from "@/components/account/canonical-mention-preference";
import { NotificationPreferencesSettings } from "@/components/account/notification-preferences-settings";
import { QuietHoursPreference } from "@/components/account/quiet-hours-preference";
import PageTitle from "@/components/page-title";
import { PersonalNotificationHistory } from "@/components/settings/personal-notification-history";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/notifications",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();

  return (
    <>
      <PageTitle title={t("settings:notificationsPage.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:notificationsPage.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:notificationsPage.subtitle")}
          </p>
        </div>

        <PersonalNotificationHistory
          audience="staff"
          userId={session?.user?.id}
          sessionId={session?.session?.id}
        />
        <CanonicalMentionPreference />
        <QuietHoursPreference />
        <NotificationPreferencesSettings />
      </div>
    </>
  );
}

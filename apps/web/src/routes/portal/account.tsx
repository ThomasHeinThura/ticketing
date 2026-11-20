import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChangePasswordCard,
  type PasswordChange,
} from "@/components/account/change-password-card";
import { PortalCanonicalPreferencesPage } from "@/components/account/portal-canonical-preferences";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { PersonalNotificationHistory } from "@/components/settings/personal-notification-history";
import { PersonalSelfHistory } from "@/components/settings/personal-self-history";
import { getApiUrl } from "@/fetchers/get-api-url";
import { capturePersonalSelfHistoryRefresh } from "@/fetchers/settings/personal-history";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

export const Route = createFileRoute("/account")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalAccountRoute,
});

function PortalAccountRoute() {
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const session = useQuery({
    queryKey: ["portal", "session"],
    queryFn: async () => {
      const result = await portalAuthClient.getSession();
      if (result.error) throw new Error("Session unavailable");
      return result.data;
    },
    staleTime: 30_000,
  });
  const historyIdentity =
    session.data?.user?.id === portalUserId ? (session.data ?? null) : null;
  return (
    <>
      <PortalPageTitle title={t("navigation.settings")} />
      <PortalCanonicalPreferencesPage
        portalUserId={portalUserId}
        history={
          <PersonalNotificationHistory
            audience="portal"
            userId={
              session.data?.user?.id === portalUserId ? portalUserId : undefined
            }
            sessionId={
              session.data?.user?.id === portalUserId
                ? session.data?.session?.id
                : undefined
            }
          />
        }
      />
      {historyIdentity?.session?.id ? (
        <div className="mx-auto w-full max-w-4xl px-6">
          <PersonalSelfHistory
            section="security"
            audience="portal"
            userId={portalUserId}
            sessionId={historyIdentity.session.id}
          />
        </div>
      ) : null}
      <PortalPasswordSettings
        key={portalUserId}
        historyIdentity={historyIdentity}
      />
    </>
  );
}

function PortalPasswordSettings({
  historyIdentity,
}: {
  historyIdentity: { user?: { id: string }; session?: { id: string } } | null;
}) {
  const { t } = usePortalTranslation("portal");
  const client = useQueryClient();
  const [hasLocalPassword, setHasLocalPassword] = useState(false);
  const [securityUnavailable, setSecurityUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    setHasLocalPassword(false);
    setSecurityUnavailable(false);
    void fetch(getApiUrl("me/security/factors"), {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error("security unavailable");
        return response.json();
      })
      .then((data: { hasLocalPassword?: boolean } | null) => {
        if (active) setHasLocalPassword(data?.hasLocalPassword === true);
      })
      .catch(() => {
        if (active) setSecurityUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function changePassword(input: PasswordChange) {
    const refreshHistory = capturePersonalSelfHistoryRefresh(
      client,
      "security",
      "portal",
      historyIdentity,
    );
    const result = await portalAuthClient.$fetch("/change-password", {
      method: "POST",
      body: input,
    });
    if (result.error) throw new Error(result.error.code ?? "UNKNOWN");
    refreshHistory();
  }
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-6">
      {securityUnavailable ? (
        <p role="alert">{t("auth:accountSecurity.unavailable")}</p>
      ) : (
        <ChangePasswordCard
          hasLocalPassword={hasLocalPassword}
          changePassword={changePassword}
        />
      )}
    </div>
  );
}

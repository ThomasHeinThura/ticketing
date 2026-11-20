import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  ChangePasswordCard,
  type PasswordChange,
} from "@/components/account/change-password-card";
import { PortalCanonicalPreferencesPage } from "@/components/account/portal-canonical-preferences";
import { PortalPageTitle } from "@/components/portal/portal-page-title";
import { getApiUrl } from "@/fetchers/get-api-url";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

const SettingsHistory = lazy(() =>
  import("@/components/settings/settings-history").then((m) => ({
    default: m.SettingsHistory,
  })),
);

export const Route = createFileRoute("/account")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalAccountRoute,
});

function PortalAccountRoute() {
  const { t } = usePortalTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  return (
    <>
      <PortalPageTitle title={t("navigation.settings")} />
      <PortalCanonicalPreferencesPage
        portalUserId={portalUserId}
        history={
          <Suspense fallback={null}>
            <SettingsHistory
              target={{
                kind: "self",
                audience: "portal",
                section: "notifications",
              }}
            />
          </Suspense>
        }
      />
      <div className="mx-auto w-full max-w-4xl px-6">
        <Suspense fallback={null}>
          <SettingsHistory
            target={{ kind: "self", audience: "portal", section: "security" }}
          />
        </Suspense>
      </div>
      <PortalPasswordSettings key={portalUserId} />
    </>
  );
}

function PortalPasswordSettings() {
  const { t } = usePortalTranslation("portal");
  const passwordChange = useMutation({
    mutationFn: async (input: PasswordChange) => {
      const result = await portalAuthClient.$fetch("/change-password", {
        method: "POST",
        body: input,
      });
      if (result.error) throw new Error(result.error.code ?? "UNKNOWN");
    },
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "portal", section: "security" },
        ],
      },
    },
  });
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
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pb-6">
      {securityUnavailable ? (
        <p role="alert">{t("auth:accountSecurity.unavailable")}</p>
      ) : (
        <ChangePasswordCard
          hasLocalPassword={hasLocalPassword}
          changePassword={passwordChange.mutateAsync}
        />
      )}
    </div>
  );
}

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import { SignInForm } from "@/components/auth/sign-in-form";
import PageTitle from "@/components/page-title";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { authClient } from "@/lib/auth-client";
import { godModeRedirectPath } from "@/lib/god-mode-paths";
import { parseOptionalStringSearch } from "@/lib/optional-string-search";

/**
 * God Mode's own sign-in page (L-03, Thomas 30 Oct, option A). Password and the existing
 * two-factor step only: no SSO, social, email-code, sign-up or invitation path, because
 * identity-provider data never grants instance admin. It creates the same session as the normal
 * sign-in; the God Mode pages and the API still decide who is an instance admin.
 */
export const Route = createFileRoute("/god-mode/sign-in")({
  validateSearch: (search: Record<string, unknown>) =>
    parseOptionalStringSearch(search, ["redirect"]),
  beforeLoad: async ({ search }) => {
    let session = null;
    try {
      const { data } = await authClient.getSession();
      session = data;
    } catch (error) {
      // A failed check is not a session: show the form, as the normal sign-in does.
      if (import.meta.env.DEV) console.warn("getSession failed", error);
    }
    // Already signed in: go straight to God Mode, which denies a non-admin.
    if (session) throw redirect({ href: godModeRedirectPath(search.redirect) });
  },
  component: GodModeSignIn,
});

function GodModeSignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { data: config, isLoading } = useGetConfig();
  const target = godModeRedirectPath(search.redirect);

  return (
    <>
      <PageTitle title={t("auth:godModeSignIn.pageTitle")} />
      <AuthLayout
        title={t("auth:godModeSignIn.title")}
        subtitle={t("auth:godModeSignIn.subtitle")}
      >
        <div className="mt-6" data-testid="god-mode-sign-in-content">
          {isLoading ? (
            <div className="space-y-3" data-testid="god-mode-sign-in-loading">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : config?.disableLoginForm ? (
            // The API refuses local sign-in on this instance, so offer no form that would fail.
            <Alert variant="error">
              <AlertDescription>
                {t("auth:godModeSignIn.passwordDisabled")}
              </AlertDescription>
            </Alert>
          ) : (
            <SignInForm
              twoFactorRedirect={target}
              onSuccess={() => void navigate({ href: target })}
            />
          )}
        </div>
      </AuthLayout>
    </>
  );
}

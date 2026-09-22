import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SSOProviders } from "@/components/auth/sso-providers";
import { AuthToggle } from "@/components/auth/toggle";
import PageTitle from "@/components/page-title";
import useGetConfig from "@/hooks/queries/config/use-get-config";

const signUpSearchSchema = z.object({
  invitationId: z.string().optional(),
  email: z.string().optional(),
  // #18: the one-time setup URL printed to the container log carries this
  // token (auth-and-identity.md § Break-glass). Its presence -- not any
  // server-reported "no users yet" state, which is deliberately no longer
  // observable pre-auth -- is what tells this page it is bootstrapping the
  // instance admin rather than doing an ordinary self-service signup. The
  // backend is the actual authority: it verifies and single-use-consumes the
  // token itself, so a wrong or reused value here just fails normally.
  setupToken: z.string().optional(),
});

export const Route = createFileRoute("/auth/sign-up")({
  component: SignUp,
  validateSearch: signUpSearchSchema,
});

function SignUp() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/auth/sign-up" });
  const navigate = useNavigate({ from: "/auth/sign-up" });
  const { data: config } = useGetConfig();

  const invitationId = search.invitationId;
  const prefillEmail = search.email;
  // #18 security review (F5, non-blocking): the token is captured into a ref
  // on first render, then stripped from the URL below -- it stays available
  // for this page's own submit, but no longer sits in the address bar,
  // browser history, or a Referer header sent to any third-party resource
  // this page loads. One-hour-or-one-use already bounds the real risk; this
  // costs nothing and closes it further.
  const setupTokenRef = useRef(search.setupToken);
  const setupToken = setupTokenRef.current;
  const isInstanceAdminSetup = Boolean(setupToken);

  // Intentionally mount-only: this strips the token from the URL exactly
  // once, right after the ref above has already captured it for actual use.
  // Re-running on navigate's own identity churn would create a loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only, see comment above
  useEffect(() => {
    if (search.setupToken) {
      navigate({
        search: (prev) => ({ ...prev, setupToken: undefined }),
        replace: true,
      });
    }
  }, []);

  const baseUrl = import.meta.env.VITE_CLIENT_URL ?? window.location.origin;
  const callbackURL = invitationId
    ? `${baseUrl}/invitation/accept/${invitationId}`
    : `${baseUrl}/dashboard`;
  const errorCallbackURL = `${baseUrl}/auth/sign-up`;

  return (
    <>
      <PageTitle title={t("auth:signUp.pageTitle")} />
      <AuthLayout
        title={
          isInstanceAdminSetup
            ? t("auth:signUp.instanceAdminTitle", {
                defaultValue: "Set up your TaskDesk instance",
              })
            : t("auth:signUp.title")
        }
        subtitle={
          isInstanceAdminSetup
            ? t("auth:signUp.instanceAdminSubtitle", {
                defaultValue:
                  "This account becomes the instance administrator with full access.",
              })
            : invitationId
              ? t("auth:signUp.subtitleInvitation")
              : config?.disableRegistration
                ? t("auth:signUp.subtitleRegistrationDisabled")
                : config?.disablePasswordRegistration
                  ? t("auth:signUp.subtitlePasswordDisabled")
                  : t("auth:signUp.subtitleDefault")
        }
      >
        <div className="space-y-4 mt-6">
          {invitationId && (
            <Alert>
              <AlertDescription>
                {t("auth:signUp.invitationAlert")}
              </AlertDescription>
            </Alert>
          )}
          {config?.disableRegistration &&
            !invitationId &&
            !isInstanceAdminSetup && (
              <Alert>
                <AlertDescription>
                  {t("auth:signUp.registrationDisabledAlert")}
                </AlertDescription>
              </Alert>
            )}
          {config?.disablePasswordRegistration && !isInstanceAdminSetup && (
            <Alert>
              <AlertDescription>
                {t("auth:signUp.passwordDisabledAlert")}
              </AlertDescription>
            </Alert>
          )}

          {(() => {
            const ssoNode = (
              <SSOProviders
                config={config}
                callbackURL={callbackURL}
                errorCallbackURL={errorCallbackURL}
                disabled={false}
              />
            );
            // Hide the self-service SSO alternatives when registration
            // is disabled and the user isn't either accepting an invitation
            // or doing first-user instance setup; otherwise the alternatives
            // would either bypass the policy or send the user into a flow
            // the backend will reject.
            const selfServiceAllowed =
              !config?.disableRegistration ||
              !!invitationId ||
              isInstanceAdminSetup;
            const hasAnySso =
              selfServiceAllowed &&
              (config?.hasGoogleSignIn ||
                config?.hasGithubSignIn ||
                config?.hasDiscordSignIn ||
                config?.hasCustomOAuth);
            const showAlternatives = hasAnySso;
            if (!showAlternatives) return null;
            return (
              <>
                <div className="space-y-3">{ssoNode}</div>
                <div className="flex items-center gap-4 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-sm text-muted-foreground">
                    {t("auth:forms.or")}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </>
            );
          })()}
          {(!config?.disablePasswordRegistration || isInstanceAdminSetup) && (
            <SignUpForm
              invitationId={invitationId}
              defaultEmail={prefillEmail}
              setupToken={setupToken}
            />
          )}
          {!isInstanceAdminSetup && (
            <AuthToggle
              message={t("auth:signUp.toggleMessage")}
              linkText={t("auth:signUp.toggleLink")}
              linkTo="/auth/sign-in"
            />
          )}
        </div>
      </AuthLayout>
    </>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPortalAuthMethods } from "@/fetchers/customer-invitation";
import { portalAuthClient } from "@/lib/portal-auth-client";
import {
  type PortalSignInStage,
  parsePortalSignInSearch,
  routes,
} from "@/lib/routes";

export const Route = createFileRoute("/sign-in")({
  validateSearch: parsePortalSignInSearch,
  component: PortalSignIn,
});

const emailStorageKey = "taskdesk:portal-sign-in-email";

function readStoredEmail() {
  try {
    return window.sessionStorage.getItem(emailStorageKey) ?? "";
  } catch {
    return "";
  }
}

function storeEmail(email: string | null) {
  try {
    if (email) window.sessionStorage.setItem(emailStorageKey, email);
    else window.sessionStorage.removeItem(emailStorageKey);
  } catch {
    // The current page can still complete sign-in when browser storage is disabled.
  }
}

function PortalSignIn() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const authMethods = useQuery({
    queryKey: ["portal", "auth-methods"],
    queryFn: getPortalAuthMethods,
    staleTime: 60_000,
  });
  const [stage, setStage] = useState<PortalSignInStage>(search.stage);
  const [factor, setFactor] = useState(search.factor);
  const [email, setEmail] = useState(readStoredEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(
    () =>
      new URLSearchParams(window.location.search).get("identity_error") ===
      "sign_in_failed",
  );
  // Stage changes replace the whole form, so the focused control unmounts and focus
  // would fall back to <body>. Move it to the first control of the new stage.
  const moveFocus = useRef(false);

  useEffect(() => {
    setStage(search.stage);
    setFactor(search.factor);
  }, [search.factor, search.stage]);

  useEffect(() => {
    if ((stage === "password" || stage === "factor") && !email) {
      setStage("email");
      void navigate({
        to: "/sign-in",
        search: {
          stage: "email",
          factor: "totp",
          ...(search.invitationId ? { invitationId: search.invitationId } : {}),
        },
        replace: true,
      });
    }
  }, [email, navigate, search.invitationId, stage]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const id =
      stage === "email"
        ? "portal-email"
        : stage === "password"
          ? "portal-password"
          : stage === "otp"
            ? "portal-email-otp"
            : "portal-factor-code";
    document.getElementById(id)?.focus();
  }, [stage]);

  function updateStage(next: PortalSignInStage, nextFactor = factor) {
    moveFocus.current = true;
    setFailed(false);
    setCode("");
    setStage(next);
    setFactor(nextFactor);
    void navigate({
      to: "/sign-in",
      search: {
        stage: next,
        factor: nextFactor,
        ...(search.invitationId ? { invitationId: search.invitationId } : {}),
      },
      replace: true,
    });
  }

  async function finishSignIn() {
    queryClient.clear();
    // The portal root swaps this page out of its sign-in frame as soon as the location changes,
    // which can remount this component before the navigation commits. The remounted page reads
    // the email back from storage; if it were already cleared it would see "password stage, no
    // email", reset itself to the email stage and cancel the navigation (a sign-in loop). Keep
    // the stored address until the navigation has finished.
    try {
      if (search.invitationId) {
        await navigate({
          to: routes.portalInvite.path,
          params: { id: search.invitationId },
        });
        return;
      }
      await navigate({ to: "/catalogue" });
    } finally {
      storeEmail(null);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const result = await portalAuthClient.signIn.email({ email, password });
      if (result.error) {
        setFailed(true);
        return;
      }
      if (
        result.data &&
        "twoFactorRedirect" in result.data &&
        result.data.twoFactorRedirect === true
      ) {
        updateStage("factor", "totp");
        return;
      }
      const session = await portalAuthClient.getSession();
      if (session.error || !session.data?.session) {
        setFailed(true);
        return;
      }
      await finishSignIn();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function submitFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const { portalProviderAuthClient } = await import(
        "@/lib/portal-auth-providers"
      );
      const result =
        factor === "backup"
          ? await portalProviderAuthClient.twoFactor.verifyBackupCode({ code })
          : await portalProviderAuthClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setFailed(true);
        return;
      }
      const session = await portalAuthClient.getSession();
      if (session.error || !session.data?.session) {
        setFailed(true);
        return;
      }
      // Reauthentication can bypass sidebar sign-out; discard the former identity.
      await finishSignIn();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function sendEmailOtp() {
    if (!authMethods.data?.emailOtp || !email || pending) return;
    setPending(true);
    setFailed(false);
    try {
      const { portalProviderAuthClient } = await import(
        "@/lib/portal-auth-providers"
      );
      const result =
        await portalProviderAuthClient.emailOtp.sendVerificationOtp({
          email,
          type: "sign-in",
          fetchOptions: search.invitationId
            ? { headers: { "x-taskdesk-invitation-id": search.invitationId } }
            : undefined,
        });
      if (result.error) {
        setFailed(true);
        return;
      }
      storeEmail(email);
      updateStage("otp");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function submitEmailOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !email) return;
    setPending(true);
    setFailed(false);
    try {
      const { portalProviderAuthClient } = await import(
        "@/lib/portal-auth-providers"
      );
      const result = await portalProviderAuthClient.signIn.emailOtp({
        email,
        otp: code,
        fetchOptions: search.invitationId
          ? { headers: { "x-taskdesk-invitation-id": search.invitationId } }
          : undefined,
      });
      if (result.error) {
        setFailed(true);
        return;
      }
      const session = await portalAuthClient.getSession();
      if (session.error || !session.data?.session) {
        setFailed(true);
        return;
      }
      await finishSignIn();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function sendMagicLink() {
    if (!authMethods.data?.magicLink || !email || pending) return;
    setPending(true);
    setFailed(false);
    setMagicLinkSent(false);
    try {
      const { portalProviderAuthClient } = await import(
        "@/lib/portal-auth-providers"
      );
      const result = await portalProviderAuthClient.signIn.magicLink({
        email,
        callbackURL: search.invitationId
          ? routes.portalInvite.build({ id: search.invitationId })
          : "/catalogue",
        fetchOptions: search.invitationId
          ? { headers: { "x-taskdesk-invitation-id": search.invitationId } }
          : undefined,
      });
      if (result.error) {
        setFailed(true);
        return;
      }
      setMagicLinkSent(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/portal/sign-in/home-realm", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          ...(search.invitationId ? { invitationId: search.invitationId } : {}),
        }),
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (
          typeof result === "object" &&
          result !== null &&
          "next" in result &&
          result.next === "sso"
        ) {
          storeEmail(null);
          setEmail("");
          window.location.assign("/api/portal/sign-in/home-realm/start");
          return;
        }
      }
    } catch {
      // Discovery is optional. Continue through the existing local method on network failure.
    } finally {
      setPending(false);
    }
    storeEmail(email);
    setPassword("");
    const methods = authMethods.data ?? (await authMethods.refetch()).data;
    if (methods?.password) updateStage("password");
    else if (!methods?.emailOtp && !methods?.magicLink) setFailed(true);
  }

  const title =
    stage === "factor" || stage === "otp"
      ? t("auth:twoFactor.title")
      : t("auth:signIn.pageTitle");
  const subtitle =
    stage === "factor" ? t("auth:twoFactor.subtitle") : t("common:appName");

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {failed ? (
            <Alert variant="error" className="mb-4">
              <AlertDescription>
                {stage === "factor"
                  ? t("auth:twoFactor.error")
                  : t("auth:signInForm.failedSignIn")}
              </AlertDescription>
            </Alert>
          ) : null}
          {magicLinkSent ? (
            <Alert variant="success" className="mb-4">
              <AlertDescription>
                {t("auth:signInForm.magicLinkSent")}
              </AlertDescription>
            </Alert>
          ) : null}
          {stage === "email" ? (
            <form className="space-y-4" onSubmit={submitEmail}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="portal-email"
              >
                {t("auth:forms.email")}
                <Input
                  id="portal-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <Button className="w-full" type="submit" disabled={pending}>
                {pending
                  ? t("auth:signInForm.signingIn")
                  : t("auth:signInForm.signIn")}
              </Button>
              {authMethods.data?.emailOtp ? (
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  disabled={pending || !email.trim()}
                  onClick={() => void sendEmailOtp()}
                >
                  {t("auth:signInForm.sendEmailCode")}
                </Button>
              ) : null}
              {authMethods.data?.magicLink ? (
                <Button
                  className="w-full"
                  type="button"
                  variant="outline"
                  disabled={pending || !email.trim()}
                  onClick={() => void sendMagicLink()}
                >
                  {t("auth:signInForm.sendMagicLink")}
                </Button>
              ) : null}
            </form>
          ) : null}
          {stage === "password" ? (
            authMethods.isPending ? (
              <div role="status" aria-label={t("auth:signInForm.signingIn")}>
                <Skeleton className="h-10 w-full" />
              </div>
            ) : authMethods.data?.password ? (
              <form className="space-y-4" onSubmit={submitPassword}>
                {/* Shown as wrapping text, not a read-only input, so a long address is never cut off. */}
                <div className="space-y-2 text-sm font-medium">
                  <span id="portal-email-label">{t("auth:forms.email")}</span>
                  <output
                    id="portal-email-readonly"
                    aria-labelledby="portal-email-label"
                    className="block break-all font-normal"
                  >
                    {email}
                  </output>
                </div>
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="portal-password"
                >
                  {t("auth:forms.password")}
                  <Input
                    id="portal-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                <Button className="w-full" type="submit" disabled={pending}>
                  {pending
                    ? t("auth:signInForm.signingIn")
                    : t("auth:signInForm.signIn")}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="w-full"
                  onClick={() => updateStage("email")}
                >
                  {t("auth:verifyOtp.changeEmail")}
                </Button>
                {authMethods.data.emailOtp ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void sendEmailOtp()}
                  >
                    {t("auth:signInForm.sendEmailCode")}
                  </Button>
                ) : null}
                {authMethods.data.magicLink ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void sendMagicLink()}
                  >
                    {t("auth:signInForm.sendMagicLink")}
                  </Button>
                ) : null}
              </form>
            ) : null
          ) : null}
          {stage === "otp" ? (
            <form className="space-y-4" onSubmit={submitEmailOtp}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="portal-email-otp"
              >
                {t("auth:forms.verificationCode")}
                <Input
                  id="portal-email-otp"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <Button
                className="w-full"
                type="submit"
                disabled={pending || !code.trim()}
              >
                {pending
                  ? t("auth:twoFactor.verifying")
                  : t("auth:twoFactor.verify")}
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => updateStage("email")}
              >
                {t("auth:verifyOtp.changeEmail")}
              </Button>
            </form>
          ) : null}
          {stage === "factor" ? (
            <form className="space-y-4" onSubmit={submitFactor}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="portal-factor-code"
              >
                {factor === "backup"
                  ? t("auth:twoFactor.backupCode")
                  : t("auth:twoFactor.authenticatorCode")}
                <Input
                  id="portal-factor-code"
                  autoComplete="one-time-code"
                  inputMode={factor === "backup" ? "text" : "numeric"}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <Button
                className="w-full"
                type="submit"
                disabled={pending || !code.trim()}
              >
                {pending
                  ? t("auth:twoFactor.verifying")
                  : t("auth:twoFactor.verify")}
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() =>
                  updateStage("factor", factor === "backup" ? "totp" : "backup")
                }
              >
                {factor === "backup"
                  ? t("auth:twoFactor.useAuthenticatorCode")
                  : t("auth:twoFactor.useBackupCode")}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

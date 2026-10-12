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
} from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { portalAuthClient } from "@/lib/portal-auth-client";
import { type PortalSignInStage, parsePortalSignInSearch } from "@/lib/routes";

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
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [stage, setStage] = useState<PortalSignInStage>(search.stage);
  const [factor, setFactor] = useState(search.factor);
  const [email, setEmail] = useState(readStoredEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setStage(search.stage);
    setFactor(search.factor);
  }, [search.factor, search.stage]);

  useEffect(() => {
    if ((stage === "password" || stage === "factor") && !email) {
      setStage("email");
      void navigate({
        to: "/sign-in",
        search: { stage: "email", factor: "totp" },
        replace: true,
      });
    }
  }, [email, navigate, stage]);

  function updateStage(next: PortalSignInStage, nextFactor = factor) {
    setFailed(false);
    setCode("");
    setStage(next);
    setFactor(nextFactor);
    void navigate({
      to: "/sign-in",
      search: { stage: next, factor: nextFactor },
      replace: true,
    });
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
      storeEmail(null);
      await navigate({ to: "/catalogue" });
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
      const result =
        factor === "backup"
          ? await portalAuthClient.twoFactor.verifyBackupCode({ code })
          : await portalAuthClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setFailed(true);
        return;
      }
      const session = await portalAuthClient.getSession();
      if (session.error || !session.data?.session) {
        setFailed(true);
        return;
      }
      storeEmail(null);
      await navigate({ to: "/catalogue" });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    storeEmail(email);
    setPassword("");
    updateStage("password");
  }

  const title =
    stage === "factor" ? t("auth:twoFactor.title") : t("auth:signIn.pageTitle");
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
              <Button className="w-full" type="submit">
                {t("auth:signInForm.signIn")}
              </Button>
            </form>
          ) : null}
          {stage === "password" ? (
            <form className="space-y-4" onSubmit={submitPassword}>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="portal-email-readonly"
              >
                {t("auth:forms.email")}
                <Input
                  id="portal-email-readonly"
                  type="email"
                  value={email}
                  readOnly
                />
              </label>
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
                {t("auth:checkEmail.changeEmail")}
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

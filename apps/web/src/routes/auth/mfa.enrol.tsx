import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { Alert, AlertDescription, Button, Input } from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

export const Route = createFileRoute("/auth/mfa/enrol")({
  component: MfaEnrollment,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
});

function getTotpSecret(uri: string): string | undefined {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "otpauth:") return undefined;
    return parsed.searchParams.get("secret") ?? undefined;
  } catch {
    return undefined;
  }
}

function isSafeRedirect(value?: string): value is string {
  if (!value?.startsWith("/") || value.startsWith("//")) return false;
  try {
    return (
      new URL(value, "http://taskdesk.invalid").origin ===
      "http://taskdesk.invalid"
    );
  } catch {
    return false;
  }
}

function MfaEnrollment() {
  const { t } = useTranslation();
  const { history } = useRouter();
  const { redirect } = useSearch({ from: "/auth/mfa/enrol" });
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const [accountsPending, setAccountsPending] = useState(true);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [hasPasswordAccount, setHasPasswordAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [step, setStep] = useState<"start" | "verify" | "codes">("start");
  const [isPending, setIsPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isSessionPending) return;
    if (!session) {
      history.replace(
        routes.authSignIn.build({ redirect: routes.authMfaEnrollment.path }),
      );
      return;
    }

    let active = true;
    setAccountsPending(true);
    setAccountsFailed(false);
    void authClient
      .listAccounts()
      .then((result) => {
        if (!active) return;
        if (result.error || !Array.isArray(result.data)) {
          setAccountsFailed(true);
          return;
        }
        setHasPasswordAccount(
          result.data.some((account) => account.providerId === "credential"),
        );
      })
      .catch(() => {
        if (active) setAccountsFailed(true);
      })
      .finally(() => {
        if (active) setAccountsPending(false);
      });

    return () => {
      active = false;
    };
  }, [history, isSessionPending, session]);

  const secret = useMemo(
    () => (setup ? getTotpSecret(setup.totpURI) : undefined),
    [setup],
  );

  const startEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasPasswordAccount && !password) {
      setFailed(true);
      return;
    }
    setIsPending(true);
    setFailed(false);
    try {
      const result = await authClient.twoFactor.enable(
        hasPasswordAccount ? { password } : {},
      );
      if (
        result.error ||
        !result.data?.totpURI ||
        !Array.isArray(result.data.backupCodes)
      ) {
        setFailed(true);
        return;
      }
      setSetup({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
      setPassword("");
      setStep("verify");
    } catch {
      setFailed(true);
    } finally {
      setIsPending(false);
    }
  };

  const verifyEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setFailed(true);
      return;
    }
    setIsPending(true);
    setFailed(false);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        setFailed(true);
        return;
      }
      setCode("");
      setStep("codes");
    } catch {
      setFailed(true);
    } finally {
      setIsPending(false);
    }
  };

  const finishEnrollment = () => {
    const destination = isSafeRedirect(redirect) ? redirect : "/dashboard";
    history.replace(
      destination === routes.authMfaEnrollment.path
        ? "/dashboard"
        : destination,
    );
  };

  if (isSessionPending || !session) {
    return (
      <AuthLayout title={t("auth:mfa.enrol.loadingTitle")}>
        <p role="status" className="text-sm text-muted-foreground">
          {t("auth:mfa.enrol.loadingDescription")}
        </p>
      </AuthLayout>
    );
  }

  const alreadyEnabled = session.user.twoFactorEnabled === true;

  return (
    <>
      <PageTitle title={t("auth:mfa.enrol.pageTitle")} />
      <AuthLayout
        title={t("auth:mfa.enrol.title")}
        subtitle={t("auth:mfa.enrol.subtitle")}
      >
        {alreadyEnabled ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="text-card-foreground">
                {t("auth:mfa.enrol.alreadyEnabled")}
              </AlertDescription>
            </Alert>
            <Button onClick={finishEnrollment} className="w-full">
              {t("auth:mfa.enrol.continue")}
            </Button>
          </div>
        ) : accountsPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("auth:mfa.enrol.checkingAccount")}
          </p>
        ) : accountsFailed ? (
          <div className="space-y-4">
            <Alert variant="error" role="alert">
              <AlertDescription className="text-card-foreground">
                {t("auth:mfa.enrol.accountCheckFailed")}
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="w-full"
            >
              {t("auth:mfa.enrol.retry")}
            </Button>
          </div>
        ) : step === "start" ? (
          <form onSubmit={startEnrollment} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("auth:mfa.enrol.instructions")}
            </p>
            {hasPasswordAccount ? (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="mfa-password">
                  {t("auth:mfa.enrol.passwordLabel")}
                </label>
                <Input
                  id="mfa-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isPending}
                />
              </div>
            ) : null}
            {failed ? (
              <Alert variant="error" role="alert">
                <AlertDescription className="text-card-foreground">
                  {t("auth:mfa.enrol.setupFailed")}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button
              type="submit"
              disabled={isPending || (hasPasswordAccount && !password)}
              className="w-full"
            >
              {isPending
                ? t("auth:mfa.enrol.starting")
                : t("auth:mfa.enrol.startEnrollment")}
            </Button>
          </form>
        ) : step === "verify" && setup ? (
          <form onSubmit={verifyEnrollment} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("auth:mfa.enrol.scanInstructions")}
            </p>
            {secret ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t("auth:mfa.enrol.setupKeyLabel")}
                </p>
                <code className="block select-all break-all rounded-md border bg-muted p-3 text-sm">
                  {secret}
                </code>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("auth:mfa.enrol.secretWarning")}
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="mfa-verify-code">
                {t("auth:mfa.enrol.codeLabel")}
              </label>
              <Input
                id="mfa-verify-code"
                name="one-time-code"
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={isPending}
                autoFocus
              />
            </div>
            {failed ? (
              <Alert variant="error" role="alert">
                <AlertDescription className="text-card-foreground">
                  {t("auth:mfa.enrol.invalidCode")}
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending
                ? t("auth:mfa.enrol.verifying")
                : t("auth:mfa.enrol.verifyAndEnable")}
            </Button>
          </form>
        ) : setup ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="text-card-foreground">
                {t("auth:mfa.enrol.backupCodesWarning")}
              </AlertDescription>
            </Alert>
            <ul
              aria-label={t("auth:mfa.enrol.backupCodesLabel")}
              className="grid grid-cols-2 gap-2"
            >
              {setup.backupCodes.map((backupCode) => (
                <li
                  key={backupCode}
                  className="rounded-md border bg-muted px-3 py-2 text-center font-mono text-sm"
                >
                  {backupCode}
                </li>
              ))}
            </ul>
            <Button onClick={finishEnrollment} className="w-full">
              {t("auth:mfa.enrol.savedCodes")}
            </Button>
          </div>
        ) : null}
      </AuthLayout>
    </>
  );
}

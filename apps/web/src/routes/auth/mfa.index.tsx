import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { Alert, AlertDescription, Button, Input } from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { authClient } from "@/lib/auth-client";
import { routes } from "@/lib/routes";

export const Route = createFileRoute("/auth/mfa/")({
  component: MfaChallenge,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    invitationId:
      typeof search.invitationId === "string" ? search.invitationId : undefined,
  }),
});

function MfaChallenge() {
  const { t } = useTranslation();
  const { history } = useRouter();
  const { redirect, invitationId } = useSearch({ from: "/auth/mfa" });
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedCode = code.trim();
    if (!submittedCode || (mode === "totp" && !/^\d{6}$/.test(submittedCode))) {
      setError(true);
      return;
    }

    setIsPending(true);
    setError(false);
    try {
      const result =
        mode === "totp"
          ? await authClient.twoFactor.verifyTotp({ code: submittedCode })
          : await authClient.twoFactor.verifyBackupCode({
              code: submittedCode,
            });

      if (result.error) {
        setError(true);
        return;
      }

      if (redirect?.startsWith("/") && !redirect.startsWith("//")) {
        history.push(redirect);
      } else if (invitationId && /^[a-z0-9_-]{1,128}$/i.test(invitationId)) {
        history.push(`/invitation/accept/${encodeURIComponent(invitationId)}`);
      } else {
        history.push("/dashboard");
      }
    } catch {
      setError(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <PageTitle title={t("auth:mfa.challenge.pageTitle")} />
      <AuthLayout
        title={t("auth:mfa.challenge.title")}
        subtitle={t("auth:mfa.challenge.subtitle")}
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? (
            <Alert variant="error" role="alert">
              <AlertDescription className="text-card-foreground">
                {t("auth:mfa.challenge.invalidCode")}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="mfa-code">
              {mode === "totp"
                ? t("auth:mfa.challenge.totpLabel")
                : t("auth:mfa.challenge.backupLabel")}
            </label>
            <Input
              id="mfa-code"
              name="one-time-code"
              type="text"
              autoComplete="one-time-code"
              inputMode={mode === "totp" ? "numeric" : "text"}
              pattern={mode === "totp" ? "[0-9]*" : undefined}
              maxLength={mode === "totp" ? 6 : 64}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={isPending}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending
              ? t("auth:mfa.challenge.verifying")
              : t("auth:mfa.challenge.continue")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={() => {
              setMode((current) => (current === "totp" ? "backup" : "totp"));
              setCode("");
              setError(false);
            }}
          >
            {mode === "totp"
              ? t("auth:mfa.challenge.useBackupCode")
              : t("auth:mfa.challenge.useAuthenticator")}
          </Button>
          <a
            className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            href={routes.authSignIn.build({ redirect, invitationId })}
          >
            {t("auth:mfa.challenge.backToSignIn")}
          </a>
        </form>
      </AuthLayout>
    </>
  );
}

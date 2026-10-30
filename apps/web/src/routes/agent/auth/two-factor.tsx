import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, Button, Input } from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import { authClient } from "@/lib/auth-client";
import { parseOptionalStringSearch } from "@/lib/optional-string-search";
import { getSafeRedirectPath } from "@/lib/safe-redirect";

export const Route = createFileRoute("/auth/two-factor")({
  component: TwoFactorChallenge,
  validateSearch: (search: Record<string, unknown>) =>
    parseOptionalStringSearch(search, ["redirect"]),
});

function TwoFactorChallenge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = backupCode
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
      if (result.error) throw new Error(t("auth:twoFactor.error"));
      // Only a safe same-origin path is followed; without one the default stays /dashboard.
      const redirectPath = getSafeRedirectPath(search.redirect);
      if (redirectPath) await navigate({ href: redirectPath });
      else await navigate({ to: "/dashboard" });
    } catch {
      setError(t("auth:twoFactor.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth:twoFactor.title")}
      subtitle={t("auth:twoFactor.subtitle")}
    >
      <form className="space-y-4" onSubmit={submit}>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <label
          className="block space-y-2 text-sm font-medium"
          htmlFor="factor-code"
        >
          {backupCode
            ? t("auth:twoFactor.backupCode")
            : t("auth:twoFactor.authenticatorCode")}
          <Input
            id="factor-code"
            autoComplete="one-time-code"
            inputMode={backupCode ? "text" : "numeric"}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
        <Button
          type="submit"
          disabled={pending || code.trim().length === 0}
          className="w-full"
        >
          {pending ? t("auth:twoFactor.verifying") : t("auth:twoFactor.verify")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="w-full"
          onClick={() => {
            setBackupCode((value) => !value);
            setCode("");
            setError(null);
          }}
        >
          {backupCode
            ? t("auth:twoFactor.useAuthenticatorCode")
            : t("auth:twoFactor.useBackupCode")}
        </Button>
      </form>
    </AuthLayout>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { ConnectedAccountsPanel } from "@/components/settings/connected-accounts-panel";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";
import { parseAccountSecuritySearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/security",
)({
  component: AccountSecurity,
  validateSearch: parseAccountSecuritySearch,
});

type FactorStatus = {
  enabled: boolean;
  required: boolean;
  passwordRequiredForEnrollment: boolean;
  policyMode: string;
};

function AccountSecurity() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { enrollmentRequired, identityLinkIntent } = search;
  const [status, setStatus] = useState<FactorStatus | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(getApiUrl("me/security/factors"), {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(t("auth:accountSecurity.unavailable"));
    setStatus((await response.json()) as FactorStatus);
  }, [t]);

  useEffect(() => {
    void refresh().catch(() => setError(t("auth:accountSecurity.unavailable")));
  }, [refresh, t]);

  async function beginEnrollment() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.enable({
        ...(status?.passwordRequiredForEnrollment ? { password } : {}),
        issuer: "TaskDesk",
      });
      if (result.error || !result.data || result.data.method !== "totp")
        throw new Error(t("auth:accountSecurity.enrollmentStartError"));
      setTotpUri(result.data.totpURI);
      setPendingBackupCodes(result.data.backupCodes);
      setPassword("");
      setPasswordDialogOpen(false);
    } catch {
      setError(t("auth:accountSecurity.enrollmentStartError"));
    } finally {
      setPending(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) throw new Error(t("auth:accountSecurity.codeError"));
      setTotpUri(null);
      setBackupCodes(pendingBackupCodes);
      setPendingBackupCodes(null);
      setCode("");
      await refresh();
    } catch {
      setError(t("auth:accountSecurity.codeError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageTitle title={t("auth:accountSecurity.pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("auth:accountSecurity.pageTitle")}
          </h1>
          <p className="text-muted-foreground">
            {t("auth:accountSecurity.description")}
          </p>
        </header>
        <ConnectedAccountsPanel
          intentId={identityLinkIntent}
          onClearIntent={() =>
            void navigate({
              to: routes.accountSecurity.path,
              search: parseAccountSecuritySearch({
                ...search,
                identityLinkIntent: undefined,
              }),
              replace: true,
            })
          }
        />
        {enrollmentRequired && !status?.enabled ? (
          <Alert>
            <AlertDescription>
              {t("auth:accountSecurity.required")}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {backupCodes ? (
          <Alert>
            <AlertDescription>
              <strong>{t("auth:accountSecurity.saveCodes")}</strong>
              <ul className="mt-3 list-inside list-disc font-mono">
                {backupCodes.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <Button className="mt-3" onClick={() => setBackupCodes(null)}>
                {t("auth:accountSecurity.savedCodes")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {status ? (
          // S8: one status row, like the General settings rows; setup starts from its button.
          <Card>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-medium">
                    {t("auth:accountSecurity.authenticatorApp")}
                  </h2>
                  {status.enabled ? (
                    <Badge variant="success">
                      {t("auth:accountSecurity.statusOn")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {t("auth:accountSecurity.statusOff")}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {status.enabled
                    ? t("auth:accountSecurity.enabledDescription")
                    : status.policyMode === "off"
                      ? t("auth:accountSecurity.enrollmentDisabled")
                      : t("auth:accountSecurity.setupDescription")}
                </p>
              </div>
              {!status.enabled && status.policyMode !== "off" && !totpUri ? (
                <Button
                  className="shrink-0"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    if (status.passwordRequiredForEnrollment)
                      setPasswordDialogOpen(true);
                    else void beginEnrollment();
                  }}
                >
                  {pending && !passwordDialogOpen
                    ? t("auth:accountSecurity.starting")
                    : t("auth:accountSecurity.setupAction")}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <p role="status">{t("auth:accountSecurity.loading")}</p>
        )}
        {!status?.enabled && totpUri ? (
          <Card>
            <CardContent className="space-y-4">
              <h2 className="text-lg font-medium">
                {t("auth:accountSecurity.scanTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("auth:accountSecurity.scanDescription")}
              </p>
              <code className="block max-h-28 overflow-auto break-all rounded bg-muted p-3 text-xs">
                {totpUri}
              </code>
              <form onSubmit={confirmEnrollment} className="space-y-3">
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="enrollment-code"
                >
                  {t("auth:accountSecurity.codeLabel")}
                </label>
                <Input
                  id="enrollment-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                />
                <Button type="submit" disabled={pending || code.length !== 6}>
                  {pending
                    ? t("auth:accountSecurity.verifying")
                    : t("auth:accountSecurity.verify")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
        <Dialog
          open={passwordDialogOpen}
          onOpenChange={(open) => {
            setPasswordDialogOpen(open);
            if (!open) setPassword("");
          }}
        >
          <DialogContent closeLabel={t("common:actions.close")}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (password.length > 0 && !pending) void beginEnrollment();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {t("auth:accountSecurity.setupTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("auth:accountSecurity.passwordPrompt")}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-2">
                {error ? (
                  <Alert variant="error">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <Label htmlFor="factor-password">
                  {t("auth:accountSecurity.passwordLabel")}
                </Label>
                <Input
                  id="factor-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </DialogPanel>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={pending || password.length === 0}
                >
                  {pending
                    ? t("auth:accountSecurity.starting")
                    : t("auth:accountSecurity.setupButton")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

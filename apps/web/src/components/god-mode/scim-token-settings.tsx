import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";

type TokenResult =
  | { configVersion: number; token: string; tokenRotatedAt: string }
  | { configVersion: number; revoked: true }
  | { data: unknown; configVersion: number };

class RequestFailure extends Error {
  constructor(readonly status: number) {
    super("SCIM token operation failed");
  }
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new RequestFailure(response.status);
  return (await response.json()) as T;
}

function failureMessage(
  error: unknown,
  action: "rotate" | "revoke" | "enable",
  t: (key: string) => string,
) {
  if (error instanceof RequestFailure) {
    if (error.status === 403) return t("scim.token.errors.forbidden");
    if (error.status === 404) return t("scim.token.errors.notFound");
    if (error.status === 409) return t("scim.token.errors.stale");
    if (error.status === 422) {
      if (action === "revoke") return t("scim.token.errors.revokeInvalid");
      if (action === "enable") return t("scim.token.errors.enableInvalid");
      return t("scim.token.errors.unavailable");
    }
  }
  return t("scim.token.errors.failed");
}

export function ScimTokenSettings({
  connectionId,
  configVersion,
  enabled,
  onConfigurationChanged,
  onReload,
}: {
  connectionId: string;
  configVersion: number;
  enabled: boolean;
  onConfigurationChanged: (version: number, enabled: boolean) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation("identityConnections");
  const [canReload, setCanReload] = useState(false);
  const [authMethod, setAuthMethod] = useState<
    "password" | "totp" | "backup_code"
  >("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenRevoked, setTokenRevoked] = useState(false);

  async function operate(action: "rotate" | "revoke" | "enable") {
    if (busy) return;
    if (authMethod === "password" ? !password : !code) {
      setError(
        authMethod === "password"
          ? t("scim.token.errors.factorRequiredPassword")
          : t("scim.token.errors.factorRequiredCode"),
      );
      return;
    }

    const request = {
      configVersion,
      kind: "settings" as const,
      enabled: true,
    };
    const operation =
      action === "enable"
        ? "scim_admin_update"
        : action === "rotate"
          ? "scim_token_rotate"
          : "scim_token_revoke";
    const binding =
      action === "enable"
        ? { kind: "operation" as const, operation, connectionId, request }
        : {
            kind: "operation" as const,
            operation,
            connectionId,
            version: configVersion,
          };
    const path =
      action === "enable"
        ? `instance/identity-connections/${encodeURIComponent(connectionId)}/scim`
        : `instance/identity-connections/${encodeURIComponent(connectionId)}/scim/${action === "rotate" ? "rotate-token" : "revoke-token"}`;
    setBusy(true);
    setError(null);
    setCanReload(false);
    setStatus(null);
    setIssuedToken(null);
    setCopied(false);
    try {
      const challenge = await requestJson<{
        challengeId: string;
        nonce: string;
      }>("me/step-up/challenges", {
        method: "POST",
        body: JSON.stringify(binding),
      });
      const proof = await requestJson<{ token: string }>("me/step-up", {
        method: "POST",
        body: JSON.stringify({
          ...binding,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: authMethod,
          ...(authMethod === "password" ? { password } : { code }),
        }),
      });
      const result = await requestJson<TokenResult>(path, {
        method: action === "enable" ? "PATCH" : "POST",
        headers: { "x-taskdesk-step-up-token": proof.token },
        body: JSON.stringify(
          action === "enable" ? request : { version: configVersion },
        ),
      });
      setStatus(
        action === "rotate"
          ? t("scim.token.rotateSuccess")
          : action === "revoke"
            ? t("scim.token.revokeSuccess")
            : t("scim.token.enableSuccess"),
      );
      if (action === "rotate" && "token" in result)
        setIssuedToken(result.token);
      if (action === "rotate") setTokenRevoked(false);
      if (action === "revoke") setTokenRevoked(true);
      onConfigurationChanged(result.configVersion, action === "enable");
    } catch (failure) {
      setError(failureMessage(failure, action, t));
      setCanReload(failure instanceof RequestFailure && failure.status === 409);
    } finally {
      setPassword("");
      setCode("");
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken);
      setCopied(true);
    } catch {
      setError(t("scim.token.clipboardFailed"));
    }
  }

  return (
    <section aria-labelledby="scim-token-heading" className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold" id="scim-token-heading">
          {t("scim.token.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("scim.token.description")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scim-token-step-up-method">
            {t("scim.common.verificationMethod")}
          </Label>
          <Select
            onValueChange={(value) => {
              if (
                value === "password" ||
                value === "totp" ||
                value === "backup_code"
              ) {
                setAuthMethod(value);
                setPassword("");
                setCode("");
              }
            }}
            value={authMethod}
          >
            <SelectTrigger id="scim-token-step-up-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">
                {t("scim.common.password")}
              </SelectItem>
              <SelectItem value="totp">
                {t("scim.common.authenticatorCode")}
              </SelectItem>
              <SelectItem value="backup_code">
                {t("scim.common.backupCode")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="scim-token-step-up-secret">
            {authMethod === "password"
              ? t("scim.token.operationPassword")
              : authMethod === "totp"
                ? t("scim.token.operationCode")
                : t("scim.token.operationBackupCode")}
          </Label>
          <Input
            autoComplete={
              authMethod === "password" ? "current-password" : "one-time-code"
            }
            id="scim-token-step-up-secret"
            onChange={(event) =>
              authMethod === "password"
                ? setPassword(event.currentTarget.value)
                : setCode(event.currentTarget.value)
            }
            type={authMethod === "password" ? "password" : "text"}
            value={authMethod === "password" ? password : code}
          />
        </div>
      </div>

      {error ? (
        <Alert variant="error">
          <AlertTitle>{t("scim.token.notSaved")}</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            {canReload ? (
              <Button onClick={onReload} type="button" variant="outline">
                {t("scim.common.reload")}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success">
          <AlertTitle>{t("scim.token.updated")}</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}
      {issuedToken ? (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="scim-issued-token">{t("scim.token.newToken")}</Label>
          <div className="flex gap-2">
            <Input
              autoComplete="off"
              id="scim-issued-token"
              readOnly
              spellCheck={false}
              value={issuedToken}
            />
            <Button
              onClick={() => void copyToken()}
              type="button"
              variant="outline"
            >
              {copied ? t("scim.token.copied") : t("scim.token.copy")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() => void operate("rotate")}
          type="button"
        >
          {busy ? t("scim.common.working") : t("scim.token.issueOrRotate")}
        </Button>
        {!tokenRevoked ? (
          <Button
            disabled={busy}
            onClick={() => void operate("revoke")}
            type="button"
            variant="destructive"
          >
            {t("scim.token.revoke")}
          </Button>
        ) : null}
        {!enabled && !tokenRevoked ? (
          <Button
            disabled={busy}
            onClick={() => void operate("enable")}
            type="button"
            variant="outline"
          >
            {t("scim.token.reenable")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

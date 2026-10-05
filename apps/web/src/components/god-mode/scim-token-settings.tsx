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
) {
  if (error instanceof RequestFailure) {
    if (error.status === 403)
      return "Fresh administrator verification was unavailable or could not be completed.";
    if (error.status === 404)
      return "This SCIM connection is no longer available.";
    if (error.status === 409)
      return "SCIM configuration changed in another session. Reload the settings before trying again.";
    if (error.status === 422) {
      if (action === "revoke")
        return "There is no active bearer token to revoke, or the token operation is unavailable.";
      if (action === "enable")
        return "SCIM cannot be enabled until a valid bearer token has been issued.";
      return "The SCIM token operation is unavailable.";
    }
  }
  return "The SCIM token operation failed. Try again.";
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
          ? "Enter your password to confirm this token operation."
          : "Enter a fresh authenticator or backup code to confirm this token operation.",
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
          ? "The new bearer is shown once below. Update the upstream credential before re-enabling SCIM."
          : action === "revoke"
            ? "The bearer was revoked and the SCIM connection is disabled."
            : "SCIM is enabled with the current bearer token.",
      );
      if (action === "rotate" && "token" in result)
        setIssuedToken(result.token);
      if (action === "rotate") setTokenRevoked(false);
      if (action === "revoke") setTokenRevoked(true);
      onConfigurationChanged(result.configVersion, action === "enable");
    } catch (failure) {
      setError(failureMessage(failure, action));
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
      setError(
        "Clipboard access was unavailable. Select and copy the token manually.",
      );
    }
  }

  return (
    <section aria-labelledby="scim-token-heading" className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold" id="scim-token-heading">
          SCIM bearer token
        </h2>
        <p className="text-sm text-muted-foreground">
          Issue or rotate a token, revoke the current token, or re-enable SCIM
          after you update the upstream credential. A rotated token is displayed
          once and is never included in settings reads. Token changes disable
          SCIM until you explicitly re-enable it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="scim-token-step-up-method">Verification method</Label>
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
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="totp">Authenticator code</SelectItem>
              <SelectItem value="backup_code">Backup code</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="scim-token-step-up-secret">
            {authMethod === "password"
              ? "Token operation password"
              : authMethod === "totp"
                ? "Token operation authenticator code"
                : "Token operation backup code"}
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
          <AlertTitle>SCIM token operation failed</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            {error.includes("Reload the settings") ? (
              <Button onClick={onReload} type="button" variant="outline">
                Reload latest settings
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success">
          <AlertTitle>SCIM token updated</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}
      {issuedToken ? (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="scim-issued-token">New token — copy it now</Label>
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
              {copied ? "Copied" : "Copy token"}
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
          {busy ? "Working…" : "Issue or rotate token"}
        </Button>
        {!tokenRevoked ? (
          <Button
            disabled={busy}
            onClick={() => void operate("revoke")}
            type="button"
            variant="destructive"
          >
            Revoke token
          </Button>
        ) : null}
        {!enabled && !tokenRevoked ? (
          <Button
            disabled={busy}
            onClick={() => void operate("enable")}
            type="button"
            variant="outline"
          >
            Re-enable SCIM
          </Button>
        ) : null}
      </div>
    </section>
  );
}

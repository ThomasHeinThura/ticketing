import { createFileRoute } from "@tanstack/react-router";
import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useCallback, useEffect, useState } from "react";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/observability",
)({ component: ObservabilitySettings });

const modules = [
  "http",
  "auth",
  "database",
  "jobs",
  "audit",
  "plugins",
  "realtime",
] as const;
const levels = ["error", "warn", "info", "debug"] as const;
type Level = (typeof levels)[number];
type Settings = {
  version: number;
  logLevels: {
    default: Level;
    modules: Partial<Record<(typeof modules)[number], Level>>;
  };
  metricsTokenConfigured: boolean;
  metricsTokenRotatedAt: string | null;
};
type FactorPolicy = {
  mode:
    | "off"
    | "optional"
    | "required_staff"
    | "required_role"
    | "required_everyone";
  requiredRoleId: string | null;
};

function ObservabilitySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [factorPolicy, setFactorPolicy] = useState<FactorPolicy | null>(null);
  const [requiredRoleIdInput, setRequiredRoleIdInput] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeMethod, setCodeMethod] = useState<"totp" | "backup_code">("totp");
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await apiFetch(getApiUrl(path), {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? "Settings changed in another session. Reload and retry."
          : "The request could not be completed.",
      );
    return body;
  }, []);

  const refresh = useCallback(async () => {
    const [observability, localFactors] = await Promise.all([
      request("instance/observability"),
      request("instance/local-factor-policy"),
    ]);
    setSettings(observability as unknown as Settings);
    const policy = (localFactors as { policy: FactorPolicy }).policy;
    setFactorPolicy(policy);
    setRequiredRoleIdInput(policy.requiredRoleId ?? "");
  }, [request]);

  useEffect(() => {
    void refresh().catch(() =>
      setError("Observability settings are unavailable."),
    );
  }, [refresh]);

  async function saveLogLevels() {
    if (!settings) return;
    setPending(true);
    setError(null);
    try {
      setSettings(
        (await request("instance/observability", {
          method: "PATCH",
          body: JSON.stringify({
            version: settings.version,
            logLevels: settings.logLevels,
          }),
        })) as unknown as Settings,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Settings could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function saveFactorPolicy() {
    if (!factorPolicy) return;
    setPending(true);
    setError(null);
    try {
      const requiredRoleId =
        factorPolicy.mode === "required_role"
          ? requiredRoleIdInput.trim()
          : null;
      const result = (await request("instance/local-factor-policy", {
        method: "PATCH",
        body: JSON.stringify({ mode: factorPolicy.mode, requiredRoleId }),
      })) as { policy: FactorPolicy };
      setFactorPolicy(result.policy);
      setRequiredRoleIdInput(result.policy.requiredRoleId ?? "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The factor policy could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }

  async function rotateMetricsToken(
    method: "password" | "totp" | "backup_code",
  ) {
    if (!settings) return;
    setPending(true);
    setError(null);
    setOneTimeToken(null);
    try {
      const binding = {
        kind: "operation",
        operation: "metrics_token_rotate",
        version: settings.version,
      };
      const challenge = (await request("me/step-up/challenges", {
        method: "POST",
        body: JSON.stringify(binding),
      })) as { challengeId: string; nonce: string };
      const proof = (await request("me/step-up", {
        method: "POST",
        body: JSON.stringify({
          ...binding,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method,
          ...(method === "password" ? { password } : { code }),
        }),
      })) as { token: string };
      const rotated = (await request(
        "instance/observability/metrics-token/rotate",
        {
          method: "POST",
          headers: { "X-TaskDesk-Step-Up-Token": proof.token },
          body: JSON.stringify({ version: settings.version }),
        },
      )) as { version: number; token: string; metricsTokenRotatedAt: string };
      setOneTimeToken(rotated.token);
      setPassword("");
      setCode("");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Token rotation could not be completed.",
      );
    } finally {
      setPending(false);
    }
  }

  function changeLevel(
    key: "default" | (typeof modules)[number],
    value: Level,
  ) {
    setSettings((current) =>
      current
        ? {
            ...current,
            logLevels:
              key === "default"
                ? { ...current.logLevels, default: value }
                : {
                    ...current.logLevels,
                    modules: { ...current.logLevels.modules, [key]: value },
                  },
          }
        : current,
    );
  }

  return (
    <>
      <PageTitle title="Observability" />
      <main className="mx-auto max-w-4xl space-y-6 bg-background">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Observability</h1>
          <p className="text-muted-foreground">
            Configure safe server log levels and the internal metrics scrape
            credential.
          </p>
        </header>
        {error ? (
          <Alert variant="error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {oneTimeToken ? (
          <Alert>
            <AlertDescription>
              <strong>Copy this token now.</strong> It will not be shown again.
              <code className="mt-2 block break-all">{oneTimeToken}</code>
              <Button className="mt-2" onClick={() => setOneTimeToken(null)}>
                I saved the token
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {settings ? (
          <>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">Local factor policy</h2>
              <p className="text-sm text-muted-foreground">
                Require verified TOTP or one-use backup codes for the selected
                audience. Unsupported upstream MFA is not accepted as proof.
              </p>
              <div className="flex items-center justify-between gap-4">
                <span>Required audience</span>
                <Select
                  value={factorPolicy?.mode ?? "optional"}
                  onValueChange={(value) => {
                    if (!value) return;
                    setFactorPolicy((current) =>
                      current
                        ? {
                            ...current,
                            mode: value as FactorPolicy["mode"],
                            requiredRoleId:
                              value === "required_role"
                                ? current.requiredRoleId
                                : null,
                          }
                        : current,
                    );
                  }}
                >
                  <SelectTrigger
                    aria-label="Required audience"
                    className="w-56"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      [
                        ["off", "Disabled"],
                        ["optional", "Optional"],
                        ["required_staff", "All staff"],
                        ["required_role", "Selected role"],
                        ["required_everyone", "Everyone"],
                      ] as const
                    ).map(([value, label]) => (
                      <SelectItem value={value} key={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {factorPolicy?.mode === "required_role" ? (
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="factor-required-role-id"
                >
                  Role ID
                  <Input
                    id="factor-required-role-id"
                    value={requiredRoleIdInput}
                    onChange={(event) =>
                      setRequiredRoleIdInput(event.target.value)
                    }
                    autoComplete="off"
                  />
                </label>
              ) : null}
              <Button
                disabled={
                  pending ||
                  !factorPolicy ||
                  (factorPolicy.mode === "required_role" &&
                    requiredRoleIdInput.trim().length === 0)
                }
                onClick={() => void saveFactorPolicy()}
              >
                {pending ? "Saving…" : "Save factor policy"}
              </Button>
            </section>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">Structured log levels</h2>
              <div className="flex items-center justify-between gap-4">
                <span>Default level</span>
                <Select
                  value={settings.logLevels.default}
                  onValueChange={(value) =>
                    value && changeLevel("default", value as Level)
                  }
                >
                  <SelectTrigger aria-label="Default level" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((level) => (
                      <SelectItem value={level} key={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {modules.map((module) => (
                <div
                  className="flex items-center justify-between gap-4 capitalize"
                  key={module}
                >
                  <span>{module}</span>
                  <Select
                    value={
                      settings.logLevels.modules[module] ??
                      settings.logLevels.default
                    }
                    onValueChange={(value) =>
                      value && changeLevel(module, value as Level)
                    }
                  >
                    <SelectTrigger aria-label={module} className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((level) => (
                        <SelectItem value={level} key={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <Button disabled={pending} onClick={() => void saveLogLevels()}>
                {pending ? "Saving…" : "Save log levels"}
              </Button>
            </section>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">Metrics scrape token</h2>
              <p className="text-sm text-muted-foreground">
                The listener is internal to the service. The token is stored as
                a digest and is only returned once after rotation.
              </p>
              <p role="status">
                {settings.metricsTokenConfigured
                  ? "A token is configured."
                  : "No token is configured."}
                {settings.metricsTokenRotatedAt
                  ? ` Last rotated ${new Date(settings.metricsTokenRotatedAt).toLocaleString()}.`
                  : ""}
              </p>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="observability-password"
              >
                Current password
              </label>
              <Input
                id="observability-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="observability-code"
              >
                Fresh factor proof
              </label>
              <Select
                value={codeMethod}
                onValueChange={(value) =>
                  setCodeMethod(value as "totp" | "backup_code")
                }
              >
                <SelectTrigger
                  aria-label="Factor proof type"
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <SelectValue>
                    {codeMethod === "totp"
                      ? "Authenticator code"
                      : "Backup code"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="totp">Authenticator code</SelectItem>
                  <SelectItem value="backup_code">Backup code</SelectItem>
                </SelectContent>
              </Select>
              <Input
                id="observability-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={pending || !password}
                  onClick={() => void rotateMetricsToken("password")}
                >
                  Verify password and rotate
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    pending ||
                    !code.trim() ||
                    (codeMethod === "totp" && !/^\d{6}$/u.test(code))
                  }
                  onClick={() => void rotateMetricsToken(codeMethod)}
                >
                  Verify factor and rotate
                </Button>
              </div>
            </section>
          </>
        ) : (
          <p role="status">Loading observability settings…</p>
        )}
      </main>
    </>
  );
}

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
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { getApiUrl } from "@/fetchers/get-api-url";
import { formatDateTime } from "@/lib/format";

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
  const { t, i18n } = useTranslation("godModeSettings");
  const translateRef = useRef(t);
  translateRef.current = t;
  // `items` lets the trigger show the label rather than the raw policy value.
  const factorAudiences: Array<{ value: FactorPolicy["mode"]; label: string }> =
    [
      { value: "off", label: t("godModePlugins:states.disabled") },
      { value: "optional", label: t("observability.optional") },
      { value: "required_staff", label: t("observability.allStaff") },
      { value: "required_role", label: t("observability.selectedRole") },
      { value: "required_everyone", label: t("localFactorEveryone") },
    ];
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
          ? translateRef.current("observability.conflict")
          : translateRef.current("observability.requestFailed"),
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
      setError(translateRef.current("observability.unavailable")),
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
        cause instanceof Error ? cause.message : t("observability.saveFailed"),
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
          : t("observability.factorSaveFailed"),
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
          : t("observability.rotateFailed"),
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
      <PageTitle title={t("navigation:sidebar.observability")} />
      <section className="mx-auto max-w-4xl space-y-6 bg-background">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("navigation:sidebar.observability")}
          </h1>
          <p className="text-muted-foreground">
            {t("observability.description")}
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
              <Trans
                i18nKey="observability.copyToken"
                ns="godModeSettings"
                components={{ strong: <strong /> }}
              />
              <code className="mt-2 block break-all">{oneTimeToken}</code>
              <Button className="mt-2" onClick={() => setOneTimeToken(null)}>
                {t("observability.tokenSaved")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {settings ? (
          <>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">
                {t("observability.factorPolicy")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("observability.factorHelp")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("localFactorStaffOnlyHelp")}
              </p>
              <div className="flex items-center justify-between gap-4">
                <span>{t("observability.requiredAudience")}</span>
                <Select
                  value={factorPolicy?.mode ?? "optional"}
                  items={factorAudiences}
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
                    aria-label={t("observability.requiredAudience")}
                    className="w-56"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {factorAudiences.map(({ value, label }) => (
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
                  {t("observability.roleId")}
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
                {pending
                  ? t("identityConnections:common.saving")
                  : t("observability.saveFactor")}
              </Button>
            </section>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">
                {t("observability.logLevels")}
              </h2>
              <div className="flex items-center justify-between gap-4">
                <span>{t("observability.defaultLevel")}</span>
                <Select
                  items={levels.map((level) => ({
                    value: level,
                    label: t(`observability.levels.${level}`),
                  }))}
                  value={settings.logLevels.default}
                  onValueChange={(value) =>
                    value && changeLevel("default", value as Level)
                  }
                >
                  <SelectTrigger
                    aria-label={t("observability.defaultLevel")}
                    className="w-40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((level) => (
                      <SelectItem value={level} key={level}>
                        {t(`observability.levels.${level}`)}
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
                  <span>{t(`observability.modules.${module}`)}</span>
                  <Select
                    items={levels.map((level) => ({
                      value: level,
                      label: t(`observability.levels.${level}`),
                    }))}
                    value={
                      settings.logLevels.modules[module] ??
                      settings.logLevels.default
                    }
                    onValueChange={(value) =>
                      value && changeLevel(module, value as Level)
                    }
                  >
                    <SelectTrigger
                      aria-label={t(`observability.modules.${module}`)}
                      className="w-40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {levels.map((level) => (
                        <SelectItem value={level} key={level}>
                          {t(`observability.levels.${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <Button disabled={pending} onClick={() => void saveLogLevels()}>
                {pending
                  ? t("identityConnections:common.saving")
                  : t("observability.saveLevels")}
              </Button>
            </section>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-lg font-medium">
                {t("observability.metricsToken")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("observability.metricsHelp")}
              </p>
              <p role="status">
                {settings.metricsTokenRotatedAt
                  ? t(
                      settings.metricsTokenConfigured
                        ? "observability.configuredRotated"
                        : "observability.notConfiguredRotated",
                      {
                        when: formatDateTime(
                          settings.metricsTokenRotatedAt,
                          i18n.language,
                        ),
                      },
                    )
                  : t(
                      settings.metricsTokenConfigured
                        ? "observability.configured"
                        : "observability.notConfigured",
                    )}
              </p>
              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="observability-password"
              >
                {t("instanceUsers:copy.19dff4dad0a7")}
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
                {t("observability.freshFactorProof")}
              </label>
              <Select
                value={codeMethod}
                onValueChange={(value) =>
                  setCodeMethod(value as "totp" | "backup_code")
                }
              >
                <SelectTrigger
                  aria-label={t("observability.factorProofType")}
                  className="rounded-md border bg-background px-3 py-2"
                >
                  <SelectValue>
                    {codeMethod === "totp"
                      ? t("identityConnections:stepUp.authenticatorCode")
                      : t("identityConnections:stepUp.backupCode")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="totp">
                    {t("identityConnections:stepUp.authenticatorCode")}
                  </SelectItem>
                  <SelectItem value="backup_code">
                    {t("identityConnections:stepUp.backupCode")}
                  </SelectItem>
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
                  {t("observability.verifyPassword")}
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
                  {t("observability.verifyFactor")}
                </Button>
              </div>
            </section>
          </>
        ) : (
          <p role="status">{t("observability.loading")}</p>
        )}
      </section>
    </>
  );
}

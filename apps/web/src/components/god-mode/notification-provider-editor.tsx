import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  type EmailProvider,
  type EmailProviderConfig,
  type EmailProviderKind,
  type EmailTestResult,
  getEmailProvider,
  saveEmailProvider,
  sendEmailProviderTest,
} from "@/fetchers/god-mode/notification-provider";
import {
  listSupportedPlugins,
  type PluginSettingsFormManifest,
  type SupportedPlugin,
} from "@/fetchers/god-mode/plugins";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import { HttpError } from "@/lib/http-error";
import {
  TestResultAlert,
  TestStatusLine,
} from "./notification-provider-test-result";
import {
  type FieldPresentation,
  isSupportedPluginSettingsForm,
  SchemaSettingsForm,
} from "./plugins/schema-settings-form";
import { FailureAlert, StepUpFields } from "./step-up-fields";

const queryKey = ["instance", "notification-provider", "email"];
const emptyConfig: EmailProviderConfig = {
  provider: "smtp",
  region: null,
  host: "",
  port: 587,
  secure: false,
  requireTLS: true,
  username: null,
  fromAddress: "",
  replyTo: null,
  captureToMailpit: false,
};

/** What Amazon SES fixes besides the host: the server rejects anything else. */
const SES_FIXED = { port: 587, secure: false, requireTLS: true } as const;
const kindOf = (config: EmailProviderConfig): EmailProviderKind =>
  config.provider ?? "smtp";
const looksLikeAddress = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);

function isEmailSettingsForm(
  value: unknown,
): value is Extract<SupportedPlugin["settingsForm"], { available: true }> {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as PluginSettingsFormManifest;
  if (!isSupportedPluginSettingsForm(manifest)) return false;
  return manifest.fields.every((field) =>
    field.group === "config"
      ? Object.hasOwn(emptyConfig, field.key.slice("config.".length))
      : true,
  );
}

export function NotificationProviderEditor() {
  const { t } = useTranslation("notificationProvider");
  const query = useQuery({ queryKey, queryFn: getEmailProvider, retry: false });
  const pluginQuery = useQuery({
    queryKey: ["god-mode", "plugins"],
    queryFn: listSupportedPlugins,
    retry: false,
  });
  if (query.isPending || pluginQuery.isPending)
    return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </Alert>
    );
  if (pluginQuery.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
        <Button variant="outline" onClick={() => void pluginQuery.refetch()}>
          {t("retry")}
        </Button>
      </Alert>
    );
  const plugin = pluginQuery.data.plugins.find(
    (item) => item.id === "notify.email",
  );
  if (!plugin || !isEmailSettingsForm(plugin.settingsForm))
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
      </Alert>
    );
  return (
    <ProviderForm
      key={query.data.version}
      provider={query.data}
      settingsForm={plugin.settingsForm}
      localMailpitCaptureAvailable={query.data.localMailpitCaptureAvailable}
      onReload={() => void query.refetch()}
    />
  );
}
function ProviderForm({
  provider,
  settingsForm,
  localMailpitCaptureAvailable,
  onReload,
}: {
  provider: EmailProvider;
  settingsForm: Extract<SupportedPlugin["settingsForm"], { available: true }>;
  localMailpitCaptureAvailable: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const step = useStepUpAction();
  const [config, setConfig] = useState(provider.config ?? emptyConfig);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [ordinaryConfigBeforeCapture, setOrdinaryConfigBeforeCapture] =
    useState<EmailProviderConfig | null>(null);
  // The custom SMTP draft while Amazon SES is chosen, so switching back restores it.
  const [smtpDraft, setSmtpDraft] = useState<EmailProviderConfig | null>(null);
  const [recipient, setRecipient] = useState(user?.email ?? "");
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);
  const [sandboxDismissed, setSandboxDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = useIntentLifecycle(String(provider.version), () => {
    setPassword("");
    setClearPassword(false);
    setNotice(null);
    setError(null);
    setTestResult(null);
  });
  const verify = useMutation({ mutationFn: sendEmailProviderTest });
  const busy = step.busy || verify.isPending;
  const kind = kindOf(config);
  const sesSelected = kind === "ses";
  const savedKind = provider.config ? kindOf(provider.config) : null;
  // A password saved for one provider is never reused for the other.
  const kindChanged = savedKind !== null && savedKind !== kind;
  const passwordKept = provider.passwordConfigured && !kindChanged;
  const hasConfig = Boolean(
    config.host || config.fromAddress || config.username,
  );
  const requireConfig = enabled || hasConfig;
  const captureSelected = config.captureToMailpit === true;
  const captureUnavailable = captureSelected && !localMailpitCaptureAvailable;
  const sesIncomplete = sesSelected && !config.region;
  const credentialsMissing =
    kindChanged && !password && !clearPassword && !captureSelected;
  const visibleSettingsForm = {
    ...settingsForm,
    fields: settingsForm.fields.filter((field) => {
      // Provider and region have their own controls above the generic fields.
      if (field.key === "config.provider" || field.key === "config.region")
        return false;
      if (field.key === "config.captureToMailpit")
        return localMailpitCaptureAvailable && !sesSelected;
      if (captureSelected && localMailpitCaptureAvailable)
        return (
          field.group !== "secret" &&
          (field.group !== "config" ||
            field.key === "config.captureToMailpit" ||
            field.key === "config.fromAddress" ||
            field.key === "config.replyTo")
        );
      return true;
    }),
  };
  const presentation: Partial<Record<string, FieldPresentation>> = sesSelected
    ? {
        "config.host": { readOnly: true },
        "config.port": { readOnly: true },
        "config.secure": { readOnly: true },
        "config.requireTLS": { readOnly: true },
        "config.username": {
          labelKey: "ses.username",
          required: true,
          helpKey: "ses.credentialsHelp",
        },
        "config.fromAddress": { helpKey: "ses.fromHelp" },
        password: { labelKey: "ses.password", required: !passwordKept },
      }
    : kindChanged
      ? { password: { required: true } }
      : {};
  const secret = clearPassword
    ? { password: null }
    : captureSelected
      ? { password: null }
      : password
        ? { password }
        : {};
  function selectKind(next: EmailProviderKind) {
    if (next === kind) return;
    if (next === "ses") {
      setSmtpDraft(config);
      setConfig(
        provider.config && savedKind === "ses"
          ? provider.config
          : {
              ...emptyConfig,
              provider: "ses",
              region: null,
              ...SES_FIXED,
              fromAddress: config.fromAddress,
              replyTo: config.replyTo,
            },
      );
    } else {
      setConfig(
        smtpDraft ??
          (provider.config && savedKind === "smtp"
            ? provider.config
            : {
                ...emptyConfig,
                fromAddress: config.fromAddress,
                replyTo: config.replyTo,
              }),
      );
      setSmtpDraft(null);
    }
    setPassword("");
    setClearPassword(false);
    setNotice(null);
    setError(null);
    setTestResult(null);
  }
  function selectRegion(region: string) {
    const option = provider.sesRegions.find((item) => item.region === region);
    if (!option) return;
    setConfig((previous) => ({
      ...previous,
      provider: "ses",
      region: option.region,
      host: option.host,
      ...SES_FIXED,
      captureToMailpit: false,
    }));
    setNotice(null);
    setTestResult(null);
  }
  function change<K extends keyof EmailProviderConfig>(
    key: K,
    value: EmailProviderConfig[K],
  ) {
    if (key === "captureToMailpit") {
      if (value === true && localMailpitCaptureAvailable) {
        setOrdinaryConfigBeforeCapture(config);
        setConfig((previous) => ({
          ...previous,
          captureToMailpit: true,
          host: "mailpit",
          port: 1025,
          secure: false,
          requireTLS: false,
          username: null,
        }));
        setPassword("");
        setClearPassword(true);
      } else {
        const ordinary = ordinaryConfigBeforeCapture;
        setConfig({
          ...(ordinary ?? config),
          captureToMailpit: false,
          ...(ordinary
            ? {}
            : {
                host: "",
                port: 587,
                secure: false,
                requireTLS: true,
                username: null,
              }),
        });
        setOrdinaryConfigBeforeCapture(null);
      }
    } else {
      setConfig((previous) => ({
        ...previous,
        [key]: value,
        ...(captureUnavailable
          ? {
              captureToMailpit: false,
              ...(key === "host"
                ? {}
                : {
                    host: "",
                    port: 587,
                    secure: false,
                    requireTLS: true,
                    username: null,
                  }),
            }
          : {}),
      }));
      if (captureUnavailable) {
        setPassword("");
        setClearPassword(true);
      }
    }
    setNotice(null);
  }
  async function save() {
    if (busy) return;
    if (credentialsMissing) {
      setError(t("credentialsRequired"));
      return;
    }
    const intent = lifecycle.capture();
    setError(null);
    setNotice(null);
    const request = {
      version: provider.version,
      enabled,
      ...(requireConfig ? { config } : {}),
      ...secret,
    };
    // Mail carries reset links, so the write needs the administrator's second factor again; the
    // single-use proof is bound to exactly this request.
    const result = await step.run(
      { operation: "notification_provider_save", ...request },
      (token) => saveEmailProvider(request, token),
    );
    if (!result.ok) {
      // A failed write never leaves the typed password behind; the failure itself is shown by
      // `step.failure`.
      if (lifecycle.isCurrent(intent)) setPassword("");
      return;
    }
    await queryClient.invalidateQueries({ queryKey });
    if (lifecycle.isCurrent(intent)) {
      setPassword("");
      setClearPassword(false);
      setNotice(t("saved"));
    }
  }
  async function sendTest() {
    if (busy) return;
    const address = recipient.trim();
    if (!looksLikeAddress(address)) {
      setError(t("testSend.recipientRequired"));
      return;
    }
    if (credentialsMissing) {
      setError(t("credentialsRequired"));
      return;
    }
    const intent = lifecycle.capture();
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const result = await verify.mutateAsync({
        version: provider.version,
        ...(requireConfig ? { config } : {}),
        ...secret,
        recipient: address,
      });
      if (!lifecycle.isCurrent(intent)) return;
      setTestResult(result);
      if (result.persisted) await queryClient.invalidateQueries({ queryKey });
    } catch (cause) {
      if (!lifecycle.isCurrent(intent)) return;
      setPassword("");
      setError(
        t(
          cause instanceof HttpError && cause.status === 409
            ? "conflict"
            : cause instanceof HttpError && cause.status === 429
              ? "rateLimited"
              : "operationFailed",
        ),
      );
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("email")}</CardTitle>
        <TestStatusLine status={provider.testStatus} />
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t(`sources.${provider.source}`)}
          </p>
          <div className="space-y-2">
            <span className="text-sm font-medium" id="email-provider-kind">
              {t("providerChoice.label")}
            </span>
            <RadioGroup
              aria-labelledby="email-provider-kind"
              className="grid gap-2 sm:grid-cols-2"
              disabled={busy}
              onValueChange={(value) => {
                if (value === "smtp" || value === "ses") selectKind(value);
              }}
              value={kind}
            >
              {(["smtp", "ses"] as const).map((option) => (
                <Label
                  className="rounded-lg border p-3 has-data-checked:border-primary"
                  htmlFor={`email-provider-kind-${option}`}
                  key={option}
                >
                  <RadioGroupItem
                    id={`email-provider-kind-${option}`}
                    value={option}
                  />
                  {t(`providerChoice.${option}`)}
                </Label>
              ))}
            </RadioGroup>
          </div>
          {sesSelected && !sandboxDismissed ? (
            <Alert role="status" variant="warning">
              <AlertTitle>{t("ses.sandboxTitle")}</AlertTitle>
              <AlertDescription>{t("ses.sandboxBody")}</AlertDescription>
              <AlertAction>
                <Button
                  onClick={() => setSandboxDismissed(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("ses.dismiss")}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {captureUnavailable ? (
            <Alert variant="error">
              <AlertTitle>{t("unavailable")}</AlertTitle>
              <AlertDescription>{t("captureUnavailable")}</AlertDescription>
            </Alert>
          ) : null}
          {captureSelected && localMailpitCaptureAvailable ? (
            <p className="text-sm text-muted-foreground">{t("captureHelp")}</p>
          ) : null}
          {sesSelected ? (
            <div className="space-y-2">
              <Label htmlFor="email-provider-region">
                {t("ses.regionLabel")}
              </Label>
              <Select
                disabled={busy}
                items={provider.sesRegions.map((option) => ({
                  value: option.region,
                  label: t("ses.regionOption", {
                    name: t(`ses.regions.${option.region}`),
                    region: option.region,
                  }),
                }))}
                onValueChange={(value) => {
                  if (typeof value === "string") selectRegion(value);
                }}
                value={config.region ?? null}
              >
                <SelectTrigger id="email-provider-region">
                  <SelectValue placeholder={t("ses.regionPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {provider.sesRegions.map((option) => (
                    <SelectItem key={option.region} value={option.region}>
                      {t("ses.regionOption", {
                        name: t(`ses.regions.${option.region}`),
                        region: option.region,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("ses.regionHelp")}
              </p>
            </div>
          ) : null}
          <SchemaSettingsForm
            manifest={visibleSettingsForm}
            enabled={enabled}
            onEnabledChange={setEnabled}
            config={
              config as unknown as Record<
                string,
                string | number | boolean | null
              >
            }
            onConfigChange={(key, value) => {
              if (!Object.hasOwn(emptyConfig, key)) return;
              const typedKey = key as keyof EmailProviderConfig;
              change(typedKey, value as EmailProviderConfig[typeof typedKey]);
            }}
            requireConfig={requireConfig}
            disabled={busy}
            password={password}
            onPasswordChange={setPassword}
            passwordConfigured={passwordKept}
            passwordPreview={provider.passwordPreview}
            clearPassword={clearPassword}
            onClearPasswordChange={(value) => {
              setClearPassword(value);
              if (value) setPassword("");
            }}
            presentation={presentation}
          />
          <div className="space-y-2">
            <Label htmlFor="email-provider-test-recipient">
              {t("testSend.recipientLabel")}
            </Label>
            <div className="flex flex-wrap items-start gap-2">
              <Input
                autoComplete="email"
                className="min-w-0 flex-1 basis-64"
                disabled={busy}
                id="email-provider-test-recipient"
                inputMode="email"
                onChange={(event) => setRecipient(event.target.value)}
                value={recipient}
              />
              <Button
                disabled={
                  busy ||
                  captureUnavailable ||
                  sesIncomplete ||
                  !config.host ||
                  !config.fromAddress ||
                  !recipient.trim()
                }
                onClick={() => void sendTest()}
                type="button"
                variant="outline"
              >
                {verify.isPending
                  ? t("testSend.sending")
                  : t("testSend.button")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("testSend.help")}
            </p>
          </div>
          {testResult ? (
            <TestResultAlert provider={kind} result={testResult} />
          ) : null}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <StepUpFields action={step} idPrefix="email-provider-step-up" />
          <FailureAlert
            failure={step.failure}
            onReload={onReload}
            title={t("operationFailed")}
          />
          <Button
            disabled={busy || captureUnavailable || sesIncomplete}
            type="submit"
          >
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

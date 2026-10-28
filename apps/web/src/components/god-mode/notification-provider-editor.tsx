import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type EmailProvider,
  type EmailProviderConfig,
  getEmailProvider,
  saveEmailProvider,
  smtpDiagnosticTranslationKey,
  verifyEmailProvider,
} from "@/fetchers/god-mode/notification-provider";
import {
  listSupportedPlugins,
  type PluginSettingsFormManifest,
  type SupportedPlugin,
} from "@/fetchers/god-mode/plugins";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { HttpError } from "@/lib/http-error";
import {
  isSupportedPluginSettingsForm,
  SchemaSettingsForm,
} from "./plugins/schema-settings-form";

const queryKey = ["instance", "notification-provider", "email"];
const emptyConfig: EmailProviderConfig = {
  host: "",
  port: 587,
  secure: false,
  requireTLS: true,
  username: null,
  fromAddress: "",
  replyTo: null,
  captureToMailpit: false,
};

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
    />
  );
}
function ProviderForm({
  provider,
  settingsForm,
  localMailpitCaptureAvailable,
}: {
  provider: EmailProvider;
  settingsForm: Extract<SupportedPlugin["settingsForm"], { available: true }>;
  localMailpitCaptureAvailable: boolean;
}) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(provider.config ?? emptyConfig);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [ordinaryConfigBeforeCapture, setOrdinaryConfigBeforeCapture] =
    useState<EmailProviderConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = useIntentLifecycle(String(provider.version), () => {
    setPassword("");
    setClearPassword(false);
    setNotice(null);
    setError(null);
  });
  const save = useMutation({ mutationFn: saveEmailProvider });
  const verify = useMutation({ mutationFn: verifyEmailProvider });
  const busy = save.isPending || verify.isPending;
  const hasConfig = Boolean(
    config.host || config.fromAddress || config.username,
  );
  const requireConfig = enabled || hasConfig;
  const captureSelected = config.captureToMailpit === true;
  const captureUnavailable = captureSelected && !localMailpitCaptureAvailable;
  const visibleSettingsForm = {
    ...settingsForm,
    fields: settingsForm.fields.filter((field) => {
      if (field.key === "config.captureToMailpit")
        return localMailpitCaptureAvailable;
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
  const secret = clearPassword
    ? { password: null }
    : captureSelected
      ? { password: null }
      : password
        ? { password }
        : {};
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
  async function submit(testOnly: boolean) {
    if (busy) return;
    const intent = lifecycle.capture();
    setError(null);
    setNotice(null);
    try {
      if (testOnly) {
        await verify.mutateAsync({
          version: provider.version,
          ...(requireConfig ? { config } : {}),
          ...secret,
        });
        if (lifecycle.isCurrent(intent)) setNotice(t("verified"));
      } else {
        await save.mutateAsync({
          version: provider.version,
          enabled,
          ...(requireConfig ? { config } : {}),
          ...secret,
        });
        await queryClient.invalidateQueries({ queryKey });
        if (lifecycle.isCurrent(intent)) {
          setPassword("");
          setClearPassword(false);
          setNotice(t("saved"));
        }
      }
    } catch (cause) {
      if (!lifecycle.isCurrent(intent)) return;
      setPassword("");
      setError(
        t(
          cause instanceof HttpError && cause.status === 409
            ? "conflict"
            : cause instanceof HttpError && cause.status === 429
              ? "rateLimited"
              : cause instanceof HttpError && cause.status === 502
                ? smtpDiagnosticTranslationKey(cause.message)
                : "operationFailed",
        ),
      );
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("email")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t(`sources.${provider.source}`)}
          </p>
          {captureUnavailable ? (
            <Alert variant="error">
              <AlertTitle>{t("unavailable")}</AlertTitle>
              <AlertDescription>{t("captureUnavailable")}</AlertDescription>
            </Alert>
          ) : null}
          {captureSelected && localMailpitCaptureAvailable ? (
            <p className="text-sm text-muted-foreground">{t("captureHelp")}</p>
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
            passwordConfigured={provider.passwordConfigured}
            passwordPreview={provider.passwordPreview}
            clearPassword={clearPassword}
            onClearPasswordChange={(value) => {
              setClearPassword(value);
              if (value) setPassword("");
            }}
          />
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
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || captureUnavailable}>
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                busy ||
                captureUnavailable ||
                !config.host ||
                !config.fromAddress
              }
              onClick={(event) => {
                if (event.currentTarget.form?.reportValidity())
                  void submit(true);
              }}
            >
              {t("test")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("testHelp")}</p>
        </form>
      </CardContent>
    </Card>
  );
}

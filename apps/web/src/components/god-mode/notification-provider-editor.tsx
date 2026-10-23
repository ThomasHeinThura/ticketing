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
  Checkbox,
  Input,
  Label,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type EmailProvider,
  type EmailProviderConfig,
  getEmailProvider,
  saveEmailProvider,
  verifyEmailProvider,
} from "@/fetchers/god-mode/notification-provider";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { HttpError } from "@/lib/http-error";

const queryKey = ["instance", "notification-provider", "email"];
const emptyConfig: EmailProviderConfig = {
  host: "",
  port: 587,
  secure: false,
  requireTLS: true,
  username: null,
  fromAddress: "",
  replyTo: null,
};
export function NotificationProviderEditor() {
  const { t } = useTranslation("notificationProvider");
  const query = useQuery({ queryKey, queryFn: getEmailProvider, retry: false });
  if (query.isPending) return <Skeleton className="h-48 w-full" />;
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
  return <ProviderForm key={query.data.version} provider={query.data} />;
}
function ProviderForm({ provider }: { provider: EmailProvider }) {
  const { t } = useTranslation("notificationProvider");
  const queryClient = useQueryClient();
  const [config, setConfig] = useState(provider.config ?? emptyConfig);
  const [enabled, setEnabled] = useState(provider.enabled);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
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
  const secret = clearPassword
    ? { password: null }
    : password
      ? { password }
      : {};
  function change<K extends keyof EmailProviderConfig>(
    key: K,
    value: EmailProviderConfig[K],
  ) {
    setConfig((previous) => ({ ...previous, [key]: value }));
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
          <div className="flex items-center gap-3">
            <Switch
              id="smtp-enabled"
              checked={enabled}
              disabled={busy}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor="smtp-enabled">{t("enabled")}</Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {t(`sources.${provider.source}`)}
          </p>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">{t("host")}</Label>
              <Input
                id="smtp-host"
                value={config.host}
                required={requireConfig}
                autoComplete="off"
                onChange={(event) => change("host", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">{t("port")}</Label>
              <Input
                id="smtp-port"
                type="number"
                min={1}
                max={65535}
                required={requireConfig}
                value={config.port}
                onChange={(event) => change("port", Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from">{t("fromAddress")}</Label>
              <Input
                id="smtp-from"
                type="email"
                required={requireConfig}
                value={config.fromAddress}
                onChange={(event) => change("fromAddress", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-reply">{t("replyTo")}</Label>
              <Input
                id="smtp-reply"
                type="email"
                value={config.replyTo ?? ""}
                onChange={(event) =>
                  change("replyTo", event.target.value || null)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-username">{t("username")}</Label>
              <Input
                id="smtp-username"
                autoComplete="off"
                value={config.username ?? ""}
                onChange={(event) =>
                  change("username", event.target.value || null)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">{t("password")}</Label>
              <Input
                id="smtp-password"
                type="password"
                autoComplete="new-password"
                disabled={clearPassword}
                value={password}
                placeholder={
                  provider.passwordConfigured
                    ? (provider.passwordPreview ?? "")
                    : ""
                }
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("passwordHelp")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="smtp-secure"
                checked={config.secure}
                onCheckedChange={(value) => change("secure", Boolean(value))}
              />
              <Label htmlFor="smtp-secure">{t("secure")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="smtp-tls"
                checked={config.requireTLS}
                onCheckedChange={(value) =>
                  change("requireTLS", Boolean(value))
                }
              />
              <Label htmlFor="smtp-tls">{t("requireTLS")}</Label>
            </div>
            {provider.passwordConfigured && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox
                  id="smtp-clear"
                  checked={clearPassword}
                  onCheckedChange={(value) => {
                    setClearPassword(Boolean(value));
                    setPassword("");
                  }}
                />
                <Label htmlFor="smtp-clear">{t("clearPassword")}</Label>
              </div>
            )}
          </fieldset>
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
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !config.host || !config.fromAddress}
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

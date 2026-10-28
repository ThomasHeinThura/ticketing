import {
  Alert,
  AlertDescription,
  AlertTitle,
  Checkbox,
  Input,
  Label,
  Switch,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type {
  PluginSettingsFormField,
  PluginSettingsFormManifest,
} from "@/fetchers/god-mode/plugins";

export type { PluginSettingsFormManifest } from "@/fetchers/god-mode/plugins";

const controls = new Set<PluginSettingsFormField["control"]>([
  "text",
  "email",
  "number",
  "checkbox",
  "switch",
  "password",
]);
const groups = new Set<PluginSettingsFormField["group"]>([
  "provider",
  "config",
  "secret",
]);

export function isSupportedPluginSettingsForm(
  value: PluginSettingsFormManifest,
): value is Extract<PluginSettingsFormManifest, { available: true }> {
  if (value.version !== 1 || !value.available || !Array.isArray(value.fields))
    return false;
  if (value.fields.length === 0 || value.fields.length > 64) return false;
  const seen = new Set<string>();
  return value.fields.every((field) => {
    if (
      typeof field.key !== "string" ||
      field.key.length > 128 ||
      !/^(?:enabled|config\.[A-Za-z][A-Za-z0-9_]{0,63}|[A-Za-z][A-Za-z0-9_]{0,63})$/u.test(
        field.key,
      ) ||
      typeof field.labelKey !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.]{0,127}$/u.test(field.labelKey) ||
      !controls.has(field.control) ||
      !groups.has(field.group) ||
      typeof field.required !== "boolean" ||
      typeof field.nullable !== "boolean" ||
      typeof field.secret !== "boolean" ||
      field.secret !== (field.group === "secret") ||
      seen.has(field.key)
    )
      return false;
    if (
      [field.minimum, field.maximum, field.minLength, field.maxLength].some(
        (constraint) =>
          constraint !== undefined &&
          (!Number.isSafeInteger(constraint) || constraint < 0),
      ) ||
      (field.pattern !== undefined && field.pattern.length > 256) ||
      (field.format !== undefined && field.format.length > 64)
    )
      return false;
    if (
      (field.group === "provider" &&
        (field.key !== "enabled" || field.control !== "switch")) ||
      (field.group === "config" &&
        (!field.key.startsWith("config.") ||
          (field.control !== "text" &&
            field.control !== "email" &&
            field.control !== "number" &&
            field.control !== "checkbox"))) ||
      (field.group === "secret" && field.control !== "password")
    )
      return false;
    seen.add(field.key);
    return true;
  });
}

type Props = {
  manifest: PluginSettingsFormManifest;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  config: Record<string, string | number | boolean | null>;
  onConfigChange: (
    key: string,
    value: string | number | boolean | null,
  ) => void;
  requireConfig: boolean;
  disabled: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  passwordConfigured: boolean;
  passwordPreview: string | null;
  clearPassword: boolean;
  onClearPasswordChange: (value: boolean) => void;
};

export function SchemaSettingsForm({
  manifest,
  enabled,
  onEnabledChange,
  config,
  onConfigChange,
  requireConfig,
  disabled,
  password,
  onPasswordChange,
  passwordConfigured,
  passwordPreview,
  clearPassword,
  onClearPasswordChange,
}: Props) {
  const { t } = useTranslation("notificationProvider");
  if (!isSupportedPluginSettingsForm(manifest))
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-4">
      {manifest.fields
        .filter((field) => field.group === "provider")
        .map((field) => (
          <div className="flex items-center gap-3" key={field.key}>
            <Switch
              id={`plugin-settings-${field.key}`}
              checked={field.key === "enabled" ? enabled : false}
              disabled={disabled}
              onCheckedChange={onEnabledChange}
            />
            <Label htmlFor={`plugin-settings-${field.key}`}>
              {t(field.labelKey)}
            </Label>
          </div>
        ))}
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        {manifest.fields
          .filter((field) => field.group === "config")
          .map((field) => {
            const key = field.key.slice("config.".length);
            const value = config[key];
            if (field.control === "checkbox")
              return (
                <div className="flex items-center gap-2" key={field.key}>
                  <Checkbox
                    id={`plugin-settings-${field.key}`}
                    checked={value === true}
                    onCheckedChange={(checked) =>
                      onConfigChange(key, checked === true)
                    }
                  />
                  <Label htmlFor={`plugin-settings-${field.key}`}>
                    {t(field.labelKey)}
                  </Label>
                </div>
              );
            if (
              field.control !== "text" &&
              field.control !== "email" &&
              field.control !== "number"
            )
              return null;
            return (
              <div className="space-y-2" key={field.key}>
                <Label htmlFor={`plugin-settings-${field.key}`}>
                  {t(field.labelKey)}
                </Label>
                <Input
                  id={`plugin-settings-${field.key}`}
                  type={field.control === "number" ? "number" : field.control}
                  inputMode={field.control === "number" ? "numeric" : undefined}
                  autoComplete={field.control === "text" ? "off" : undefined}
                  value={
                    typeof value === "string" || typeof value === "number"
                      ? value
                      : ""
                  }
                  required={requireConfig && field.required && !field.nullable}
                  min={field.minimum}
                  max={field.maximum}
                  minLength={field.minLength}
                  maxLength={field.maxLength}
                  pattern={field.pattern}
                  onChange={(event) => {
                    const next =
                      field.control === "number"
                        ? Number(event.target.value)
                        : event.target.value || (field.nullable ? null : "");
                    onConfigChange(key, next);
                  }}
                />
              </div>
            );
          })}
        {manifest.fields
          .filter((field) => field.group === "secret")
          .map((field) => (
            <div className="space-y-2 sm:col-span-2" key={field.key}>
              <Label htmlFor={`plugin-settings-${field.key}`}>
                {t(field.labelKey)}
              </Label>
              <Input
                id={`plugin-settings-${field.key}`}
                type="password"
                autoComplete="new-password"
                disabled={disabled || clearPassword}
                value={password}
                placeholder={passwordConfigured ? (passwordPreview ?? "") : ""}
                required={requireConfig && field.required}
                minLength={field.minLength}
                maxLength={field.maxLength}
                onChange={(event) => onPasswordChange(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("passwordHelp")}
              </p>
              {passwordConfigured ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`plugin-settings-clear-${field.key}`}
                    checked={clearPassword}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onClearPasswordChange(checked === true)
                    }
                  />
                  <Label htmlFor={`plugin-settings-clear-${field.key}`}>
                    {t("clearPassword")}
                  </Label>
                </div>
              ) : null}
            </div>
          ))}
      </fieldset>
    </div>
  );
}

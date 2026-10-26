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
import { useTranslation } from "react-i18next";
import type { StepUpMethod } from "@/fetchers/god-mode/instance-users";
import type { StepUpAction, StepUpFailure } from "@/hooks/use-step-up-action";

export function StepUpFields({
  action,
  idPrefix,
}: {
  action: StepUpAction;
  idPrefix: string;
}) {
  const { t } = useTranslation("identityConnections");
  const labelFor = (method: StepUpMethod) =>
    method === "password"
      ? t("stepUp.password")
      : method === "totp"
        ? t("stepUp.authenticatorCode")
        : method === "backup_code"
          ? t("stepUp.backupCode")
          : t("stepUp.ssoPromptLogin");
  const localMethod = action.method !== "sso_prompt_login";
  return (
    <fieldset className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{t("stepUp.title")}</legend>
      <p className="text-sm text-muted-foreground sm:col-span-2">
        {t("stepUp.description")}
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-method`}>{t("stepUp.method")}</Label>
        <Select
          items={action.availableMethods.map((method) => ({
            value: method,
            label: labelFor(method),
          }))}
          disabled={action.busy}
          onValueChange={(value) => {
            if (
              value === "password" ||
              value === "totp" ||
              value === "backup_code" ||
              value === "sso_prompt_login"
            )
              action.setMethod(value as StepUpMethod);
          }}
          value={action.method}
        >
          <SelectTrigger id={`${idPrefix}-method`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {action.availableMethods.map((method) => (
              <SelectItem key={method} value={method}>
                {labelFor(method)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {localMethod ? (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-secret`}>
            {labelFor(action.method)}
          </Label>
          <Input
            autoComplete={
              action.method === "password"
                ? "current-password"
                : "one-time-code"
            }
            disabled={action.busy}
            id={`${idPrefix}-secret`}
            inputMode={action.method === "totp" ? "numeric" : undefined}
            onChange={(event) => action.setSecret(event.currentTarget.value)}
            type={action.method === "password" ? "password" : "text"}
            value={action.secret}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          {t("stepUp.ssoPromptLoginDescription")}
        </p>
      )}
      {action.availableMethods.length === 0 ? (
        <p className="text-sm text-destructive sm:col-span-2">
          {t("stepUp.unavailable")}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Truthful, secret-free explanation of why a protected write did not happen. */
export function FailureAlert({
  failure,
  title,
  onReload,
}: {
  failure: StepUpFailure | null;
  title: string;
  onReload?: () => void;
}) {
  const { t } = useTranslation("identityConnections");
  if (!failure) return null;
  const description =
    failure.kind === "conflict"
      ? failure.currentVersion === null
        ? t("errors.conflict")
        : t("errors.conflictVersion", { version: failure.currentVersion })
      : t(`errors.${failure.kind}`);
  const reloadable =
    onReload &&
    (failure.kind === "conflict" ||
      failure.kind === "not_found" ||
      failure.kind === "invalid" ||
      failure.kind === "duplicate");
  return (
    <Alert variant="error">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        {reloadable ? (
          <Button onClick={onReload} type="button" variant="outline">
            {t("common.reload")}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

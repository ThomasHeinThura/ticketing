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
  const label =
    action.method === "password"
      ? t("stepUp.password")
      : action.method === "totp"
        ? t("stepUp.authenticatorCode")
        : t("stepUp.backupCode");
  return (
    <fieldset className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{t("stepUp.title")}</legend>
      <p className="text-sm text-muted-foreground sm:col-span-2">
        {t("stepUp.description")}
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-method`}>{t("stepUp.method")}</Label>
        <Select
          items={[
            { value: "password", label: t("stepUp.password") },
            { value: "totp", label: t("stepUp.authenticatorCode") },
            { value: "backup_code", label: t("stepUp.backupCode") },
          ]}
          disabled={action.busy}
          onValueChange={(value) => {
            if (
              value === "password" ||
              value === "totp" ||
              value === "backup_code"
            )
              action.setMethod(value as StepUpMethod);
          }}
          value={action.method}
        >
          <SelectTrigger id={`${idPrefix}-method`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">{t("stepUp.password")}</SelectItem>
            <SelectItem value="totp">
              {t("stepUp.authenticatorCode")}
            </SelectItem>
            <SelectItem value="backup_code">
              {t("stepUp.backupCode")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-secret`}>{label}</Label>
        <Input
          autoComplete={
            action.method === "password" ? "current-password" : "one-time-code"
          }
          disabled={action.busy}
          id={`${idPrefix}-secret`}
          inputMode={action.method === "totp" ? "numeric" : undefined}
          onChange={(event) => action.setSecret(event.currentTarget.value)}
          type={action.method === "password" ? "password" : "text"}
          value={action.secret}
        />
      </div>
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

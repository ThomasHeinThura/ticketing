import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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
  getInstanceHealth,
  type HealthCheck,
  type HealthState,
} from "@/fetchers/god-mode/instance-health";
import { formatDateTime } from "@/lib/format";
import { RotateSecretsDialog } from "./rotate-secrets-dialog";

const BADGE: Record<
  HealthState,
  "success" | "warning" | "destructive" | "secondary"
> = {
  ok: "success",
  degraded: "warning",
  failing: "destructive",
  unknown: "secondary",
};

function detailLine(
  t: (key: string, options?: Record<string, unknown>) => string,
  check: HealthCheck,
) {
  const entries = Object.entries(check.detail).filter(
    ([, value]) => value !== null,
  );
  return entries
    .map(([key, value]) =>
      typeof value === "boolean"
        ? `${t(`details.${key}`, { defaultValue: key })}: ${t(value ? "yes" : "no")}`
        : `${t(`details.${key}`, { defaultValue: key })}: ${value}`,
    )
    .join(" · ");
}

/** God Mode landing page: what is working and what is not, at a glance. */
export function InstanceHealthPanel() {
  const { t } = useTranslation("godModeHealth");
  const query = useQuery({
    queryKey: ["instance", "health"],
    queryFn: getInstanceHealth,
    retry: false,
  });
  const [rotating, setRotating] = useState(false);
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
  const health = query.data;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{t("overall")}</CardTitle>
          <Badge variant={BADGE[health.state]}>
            {t(`states.${health.state}`)}
          </Badge>
        </div>
        <CardDescription>
          {t("checkedAt", { when: formatDateTime(health.checkedAt) })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {health.checks.map((check) => (
            <li
              key={check.key}
              className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-sm">
                  {t(`checks.${check.key}.name`, { defaultValue: check.key })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t(`checks.${check.key}.description`, { defaultValue: "" })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {detailLine(t, check)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {check.key === "secrets_encryption" &&
                check.detail.keyConfigured === true &&
                check.detail.rekeyComplete !== true ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRotating(true)}
                  >
                    {t("rotateSecrets.action")}
                  </Button>
                ) : null}
                <Badge variant={BADGE[check.state]}>
                  {t(`states.${check.state}`)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
        <div className="pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("refresh")}
          </Button>
        </div>
      </CardContent>
      {rotating ? (
        <RotateSecretsDialog onClose={() => setRotating(false)} />
      ) : null}
    </Card>
  );
}

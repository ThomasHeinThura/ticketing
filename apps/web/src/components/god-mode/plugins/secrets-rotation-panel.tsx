import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { getInstanceHealth } from "@/fetchers/god-mode/instance-health";
import { routes } from "@/lib/routes";
import { RotateSecretsDialog } from "../rotate-secrets-dialog";

/** GM-13: reuse the existing elevated rotation operation and live progress. */
export function SecretsRotationPanel() {
  const { t } = useTranslation("godModeHealth");
  const [rotating, setRotating] = useState(false);
  const query = useQuery({
    queryKey: ["instance", "health"],
    queryFn: getInstanceHealth,
    retry: false,
    throwOnError: false,
    refetchInterval: (current) =>
      current.state.data?.checks.some(
        (check) =>
          check.key === "secrets_encryption" &&
          typeof check.detail.secretsPendingRekey === "number" &&
          check.detail.secretsPendingRekey > 0,
      )
        ? 5_000
        : false,
  });
  const check = query.data?.checks.find(
    (row) => row.key === "secrets_encryption",
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("checks.secrets_encryption.name")}</CardTitle>
        <CardDescription>
          {t("checks.secrets_encryption.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : query.isError || !check ? (
          <Alert variant="error">
            <AlertTitle>{t("unavailable")}</AlertTitle>
            <AlertDescription>{t("loadFailed")}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2 text-sm" aria-live="polite">
            <Badge
              variant={
                check.state === "ok"
                  ? "success"
                  : check.state === "failing"
                    ? "destructive"
                    : "secondary"
              }
            >
              {t(`states.${check.state}`)}
            </Badge>
            {(["secretsTotal", "secretsPendingRekey"] as const).map((key) =>
              typeof check.detail[key] === "number" ? (
                <p key={key}>
                  {t(`details.${key}`)}: {check.detail[key]}
                </p>
              ) : null,
            )}
            {check.detail.rekeyComplete === true ? (
              <p>
                {t("details.rekeyComplete")}: {t("yes")}
              </p>
            ) : null}
            {check.detail.safeToRemovePreviousKey === true ? (
              <p>
                {t("details.safeToRemovePreviousKey")}: {t("yes")}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={check?.detail.keyConfigured !== true || query.isError}
            onClick={() => setRotating(true)}
          >
            {t("rotateSecrets.action")}
          </Button>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("refresh")}
          </Button>
          <Button
            variant="outline"
            render={<Link to={routes.godModeJobs.path} />}
          >
            {t("rotateSecrets.jobs")}
          </Button>
        </div>
      </CardContent>
      {rotating ? (
        <RotateSecretsDialog onClose={() => setRotating(false)} />
      ) : null}
    </Card>
  );
}

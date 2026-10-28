import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Progress,
  Skeleton,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { FeatureDisabledError, getModules } from "@/fetchers/agile";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";
import { formatCalendarDate, MODULE_STATE_VARIANT } from "./agile-format";
import { FeatureOff } from "./feature-off";
import { ModuleForecastText } from "./module-forecast";
import { ModuleFormDialog } from "./module-form-dialog";

/**
 * The modules of a project (`MO-1`, `MO-4`): lead, status, target date, progress and the
 * forecast range. Hidden behind `feature.modules`, which is off by default.
 */
export function ModulesList({ projectKey }: { projectKey: string }) {
  const { t, i18n } = useTranslation("agile");
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["agile", "modules", projectKey],
    queryFn: () => getModules(projectKey),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) && count < 2,
  });

  if (query.error instanceof FeatureDisabledError)
    return <FeatureOff feature="modules" />;
  if (query.isLoading)
    return (
      <div
        className="mx-auto flex max-w-4xl flex-col gap-3 p-4"
        role="status"
        aria-label={t("common.loading")}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="mx-auto max-w-4xl p-4">
        <Alert variant="error">
          <AlertDescription>{t("modules.loadFailed")}</AlertDescription>
        </Alert>
      </div>
    );

  const { data: modules, meta } = query.data;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <PageTitle title={t("modules.pageTitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          className="font-semibold text-lg"
          title={getDefaultAgentTerm(i18n, "module", 2)}
        >
          {t("modules.title")}
        </h1>
        {meta.canManage ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("modules.create")}
          </Button>
        ) : null}
      </div>
      {modules.length === 0 ? (
        <Empty data-testid="modules-empty">
          <EmptyHeader>
            <EmptyTitle>{t("modules.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("modules.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {modules.map((module) => (
            <li key={module.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      to="/agent/projects/$projectKey/modules/$moduleId"
                      params={{ projectKey, moduleId: module.id }}
                      className="truncate hover:underline"
                    >
                      {module.name}
                    </Link>
                    <Badge variant={MODULE_STATE_VARIANT[module.state]}>
                      {t(`modules.state.${module.state}`)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pt-0">
                  <p className="text-muted-foreground text-xs">
                    {module.lead
                      ? t("modules.lead", { name: module.lead.name ?? "-" })
                      : t("modules.noLead")}
                    {module.targetDate
                      ? ` · ${t("modules.target", {
                          date: formatCalendarDate(
                            module.targetDate,
                            i18n.language,
                          ),
                        })}`
                      : ""}
                  </p>
                  <Progress
                    value={module.progress.percent}
                    aria-label={t("modules.progress.label")}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("modules.progress.line", {
                      completed: module.progress.completed,
                      total: module.progress.total,
                      remaining: module.progress.remaining,
                    })}
                  </p>
                  <ModuleForecastText forecast={module.forecast} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <ModuleFormDialog
          projectKey={projectKey}
          leadCandidates={meta.leadCandidates}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

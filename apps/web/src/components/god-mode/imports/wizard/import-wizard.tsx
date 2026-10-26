import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@taskdesk/ui";
import { Check } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ImportRunState } from "@/fetchers/god-mode/imports";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { DiscoverStep } from "./discover-step";
import { DryRunStep } from "./dry-run-report";
import { ExecuteStep } from "./execute-progress";
import { MappingStep } from "./mapping-table";
import { ReconcileStep, type ReconciliationSummary } from "./reconcile-step";
import { useEngineRun } from "./use-engine-run";
import {
  clampStep,
  defaultStepFor,
  maxStepFor,
  pluginLabelKey,
  WIZARD_STEPS,
  type WizardStep,
} from "./wizard-model";

function stateVariant(state: ImportRunState) {
  if (state === "completed") return "success" as const;
  if (state === "failed") return "error" as const;
  if (state === "running" || state === "queued") return "warning" as const;
  return "outline" as const;
}

/**
 * The import wizard for one engine run. Steps are Tabs in pipeline order; a step opens only once
 * the run's phase allows it, and the open step lives in the URL (`step`), clamped to the phase.
 */
export function ImportWizard({
  runId,
  step,
  onStepChange,
  onWorkspaceResolved,
  reconciliation,
}: {
  runId: string;
  step?: WizardStep;
  onStepChange: (step: WizardStep) => void;
  onWorkspaceResolved?: (workspaceId: string) => void;
  reconciliation?: ReconciliationSummary;
}) {
  const { t } = useTranslation("godModeImports");
  const query = useEngineRun(runId);
  const run = query.data;
  useEffect(() => {
    if (run?.workspaceId) onWorkspaceResolved?.(run.workspaceId);
  }, [onWorkspaceResolved, run?.workspaceId]);

  if (query.isPending) return <Skeleton className="h-80 w-full" />;
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("detailLoadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("detailLoadErrorDescription")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  if (!run) return null;
  const current = clampStep(step, run.phase);
  const limit = WIZARD_STEPS.indexOf(maxStepFor(run.phase));
  const reached = WIZARD_STEPS.indexOf(defaultStepFor(run.phase));

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-all text-base">
              {run.sourceRef}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {t(`wizard.plugins.${pluginLabelKey(run.pluginId)}`)}
            </p>
          </div>
          <Badge variant={stateVariant(run.state)}>
            {t(`states.${run.state}`)}
          </Badge>
        </CardHeader>
      </Card>

      <Tabs
        value={current}
        onValueChange={(value) => onStepChange(value as WizardStep)}
      >
        <TabsList
          variant="underline"
          aria-label={t("wizard.steps.label")}
          className="w-full flex-wrap justify-start"
        >
          {WIZARD_STEPS.map((candidate, index) => (
            <TabsTab
              key={candidate}
              value={candidate}
              disabled={index > limit}
              className="gap-2"
            >
              {index < reached ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <span className="text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
              )}
              {t(`wizard.steps.${candidate}`)}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="connect" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("wizard.connect.connectedTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail
                label={t("plugin")}
                value={t(`wizard.plugins.${pluginLabelKey(run.pluginId)}`)}
              />
              <Detail label={t("sourceRef")} value={run.sourceRef} />
              <Detail label={t("projectId")} value={run.projectId ?? "—"} />
              <Detail
                label={t("createdAt")}
                value={formatDateTime(run.createdAt)}
              />
            </CardContent>
          </Card>
        </TabsPanel>
        <TabsPanel value="discover" className="pt-4">
          <DiscoverStep
            run={run}
            onDiscovered={() => onStepChange("mapping")}
          />
        </TabsPanel>
        <TabsPanel value="mapping" className="pt-4">
          <MappingStep run={run} onContinue={() => onStepChange("dry-run")} />
        </TabsPanel>
        <TabsPanel value="dry-run" className="pt-4">
          <DryRunStep run={run} onContinue={() => onStepChange("execute")} />
        </TabsPanel>
        <TabsPanel value="execute" className="pt-4">
          <ExecuteStep
            run={run}
            onNeedDryRun={() => onStepChange("dry-run")}
            onCompleted={() => onStepChange("reconcile")}
          />
        </TabsPanel>
        <TabsPanel value="reconcile" className="pt-4">
          <ReconcileStep run={run} reconciliation={reconciliation} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="break-all font-medium">{value}</p>
    </div>
  );
}

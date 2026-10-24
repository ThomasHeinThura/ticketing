import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
} from "@taskdesk/ui";
import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Automation,
  dryRunAutomation,
} from "@/fetchers/automation/automations";
import { formatDateTime } from "@/lib/format";
import { PickerSelect } from "./picker-select";

const WINDOW_OPTIONS = [1, 3, 7, 14, 30] as const;

/**
 * `AM-9`: "this rule would have fired 47 times in the last 7 days, on these items." Read-only,
 * default 7 days, at most 30, at most 1,000 candidates; the panel also lists whether the rule's
 * effective role may take each action (`AM-3`) and every placeholder's visibility (`AM-11`).
 */
export function AutomationDryRunDialog({
  rule,
  onClose,
}: {
  rule: Automation;
  onClose: () => void;
}) {
  const { t } = useTranslation("automations");
  const [windowDays, setWindowDays] = useState("7");
  const run = useMutation({
    mutationFn: (days: number) => dryRunAutomation(rule.id, days),
  });
  const { mutate } = run;
  // Run once on open with the default window, so the first view already answers the question.
  useEffect(() => {
    mutate(7);
  }, [mutate]);
  const result = run.data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl"
        closeLabel={t("common:actions.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("dryRun.title", { name: rule.name })}</DialogTitle>
          <DialogDescription>{t("dryRun.description")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="dry-run-window">{t("dryRun.window")}</Label>
              <PickerSelect
                id="dry-run-window"
                value={windowDays}
                options={WINDOW_OPTIONS.map((days) => ({
                  value: String(days),
                  label: t("dryRun.days", { total: days }),
                }))}
                placeholder={t("dryRun.window")}
                disabled={run.isPending}
                onChange={setWindowDays}
              />
            </div>
            <Button
              variant="outline"
              disabled={run.isPending}
              onClick={() => run.mutate(Number.parseInt(windowDays, 10))}
            >
              <FlaskConical aria-hidden="true" />
              {t("dryRun.run")}
            </Button>
          </div>
          {run.isPending ? (
            <div role="status" aria-label={t("dryRun.running")}>
              <Skeleton className="h-16 w-full" />
            </div>
          ) : run.isError ? (
            <Alert variant="error">
              <AlertTitle>{t("dryRun.failed")}</AlertTitle>
              <AlertDescription>
                {run.error instanceof Error ? run.error.message : null}
              </AlertDescription>
            </Alert>
          ) : result ? (
            <>
              <Alert variant={result.wouldFire > 0 ? "info" : "default"}>
                <AlertTitle>
                  {t("dryRun.summary", {
                    count: result.wouldFire,
                    days: result.windowDays,
                  })}
                </AlertTitle>
                <AlertDescription>
                  {t("dryRun.evaluated", { count: result.evaluated })}
                  {result.capped ? ` ${t("dryRun.capped")}` : ""} {result.note}
                </AlertDescription>
              </Alert>
              {result.samples.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {t("dryRun.samples")}
                  </h3>
                  <ul className="divide-y rounded-md border">
                    {result.samples.map((sample) => (
                      <li
                        key={sample.eventId ?? `${sample.workItemKey}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-xs">
                            {sample.workItemKey ?? t("dryRun.noItem")}
                          </span>{" "}
                          {sample.workItemTitle}
                        </span>
                        {sample.occurredAt ? (
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(sample.occurredAt)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {t("dryRun.validation")}
                </h3>
                <ul className="divide-y rounded-md border">
                  {result.actions.map((action) => (
                    <li
                      key={action.index}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        {t(`actions.types.${action.type}`, {
                          defaultValue: action.type,
                        })}
                      </span>
                      <Badge variant={action.allowed ? "success" : "error"}>
                        {action.allowed
                          ? t("dryRun.allowed")
                          : t("dryRun.refused", {
                              capability: action.requiredCapability,
                            })}
                      </Badge>
                    </li>
                  ))}
                </ul>
                {result.placeholders.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("dryRun.noPlaceholders")}
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {result.placeholders.map((placeholder) => (
                      <li
                        key={`${placeholder.actionIndex}:${placeholder.path}`}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="font-mono text-xs">
                          {placeholder.path}
                        </span>
                        <Badge
                          variant={
                            placeholder.visibility === "public"
                              ? "success"
                              : "warning"
                          }
                        >
                          {t(`dryRun.visibility.${placeholder.visibility}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

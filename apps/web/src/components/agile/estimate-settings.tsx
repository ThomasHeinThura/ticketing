import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from "@taskdesk/ui";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerSelect } from "@/components/automation/picker-select";
import {
  ESTIMATE_SYSTEMS,
  EstimateConfirmationError,
  type EstimatePreview,
  type EstimateSystem,
  FeatureDisabledError,
  getEstimates,
  INCOMPLETE_POLICIES,
  type IncompletePolicy,
  updateAgileSettings,
  updateEstimates,
} from "@/fetchers/agile";
import { toast } from "@/lib/toast";
import { EstimatePreviewDialog } from "./estimate-preview-dialog";
import { FeatureOff } from "./feature-off";

type DraftPoint = { key?: string; value: string };

/**
 * Project settings: the estimate system and its scale (`ES-1`), and the default for incomplete
 * items at cycle completion (`CY-6`). A change goes through the API's dry run first and the
 * planner confirms what maps and what clears (`ES-3`) before it is applied.
 */
export function EstimateSettings({
  projectKey,
  canManage,
}: {
  projectKey: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("agile");
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["agile", "estimate-settings", projectKey],
    queryFn: () => getEstimates(projectKey),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) && count < 2,
  });
  const [system, setSystem] = useState<EstimateSystem>("points");
  const [points, setPoints] = useState<DraftPoint[]>([]);
  const [preview, setPreview] = useState<EstimatePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const estimate = query.data;

  useEffect(() => {
    if (!estimate) return;
    const current = estimate.system ?? "points";
    setSystem(current);
    setPoints(
      estimate.system
        ? estimate.points.map((point) => ({
            key: point.key,
            value: point.value,
          }))
        : estimate.defaults.points.map((value) => ({ value })),
    );
  }, [estimate]);

  const input = () => ({
    system,
    points: points
      .filter((point) => point.value.trim() !== "")
      .map((point) => ({
        ...(point.key ? { key: point.key } : {}),
        value: point.value.trim(),
      })),
  });

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["agile"] });
    await cache.invalidateQueries({ queryKey: ["work-items"] });
  };

  const dryRun = useMutation({
    mutationFn: () => updateEstimates(projectKey, { ...input(), dryRun: true }),
    onSuccess: async (result) => {
      const { preview: next } = result;
      const quiet =
        next.mappedItems === 0 &&
        next.clearedItems === 0 &&
        next.activeCycles.length === 0;
      if (quiet) {
        apply.mutate(false);
        return;
      }
      setPreview(next);
    },
    onError: (error) =>
      setProblem(
        error instanceof Error ? error.message : t("estimates.failed"),
      ),
  });
  const apply = useMutation({
    mutationFn: (confirmClear: boolean) =>
      updateEstimates(projectKey, { ...input(), confirmClear }),
    onSuccess: async () => {
      setPreview(null);
      await refresh();
      toast.success(t("estimates.saved"));
    },
    onError: (error) => {
      if (error instanceof EstimateConfirmationError) {
        setPreview(error.preview);
        return;
      }
      setPreview(null);
      setProblem(
        error instanceof Error ? error.message : t("estimates.failed"),
      );
    },
  });
  const policy = useMutation({
    mutationFn: (value: IncompletePolicy) =>
      updateAgileSettings(projectKey, { incompletePolicy: value }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("estimates.policy.saved"));
    },
    onError: () => toast.error(t("estimates.policy.failed")),
  });

  if (query.error instanceof FeatureDisabledError)
    return <FeatureOff feature="estimates" />;
  if (query.isLoading)
    return (
      <div role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (query.isError || !estimate)
    return (
      <Alert variant="error">
        <AlertDescription>{t("estimates.loadFailed")}</AlertDescription>
      </Alert>
    );

  const disabled = !canManage || dryRun.isPending || apply.isPending;
  const changeSystem = (next: EstimateSystem) => {
    setSystem(next);
    setPoints(estimate.defaults[next].map((value) => ({ value })));
  };

  return (
    <div className="flex flex-col gap-6" data-testid="estimate-settings">
      <Card>
        <CardHeader>
          <CardTitle>{t("estimates.title")}</CardTitle>
          <CardDescription>{t("estimates.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-xs flex-col gap-1.5">
            <Label htmlFor="estimate-system">{t("estimates.system")}</Label>
            <PickerSelect
              id="estimate-system"
              value={system}
              disabled={disabled}
              options={ESTIMATE_SYSTEMS.map((value) => ({
                value,
                label: t(`systems.${value}`),
              }))}
              placeholder={t("estimates.system")}
              onChange={(value) => changeSystem(value as EstimateSystem)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("estimates.scale")}</Label>
            <p className="text-muted-foreground text-xs">
              {t(`estimates.scaleHint.${system}`)}
            </p>
            <ul className="flex flex-wrap gap-2">
              {points.map((point, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: draft rows have no identity until saved
                  key={`${point.key ?? "new"}-${index}`}
                  className="flex items-center gap-1"
                >
                  <Input
                    className="w-20"
                    value={point.value}
                    maxLength={32}
                    disabled={disabled}
                    aria-label={t("estimates.pointLabel", { index: index + 1 })}
                    onChange={(event) =>
                      setPoints((rows) =>
                        rows.map((row, at) =>
                          at === index
                            ? { ...row, value: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled || points.length <= 1}
                    aria-label={t("estimates.removePoint", {
                      value: point.value || String(index + 1),
                    })}
                    onClick={() =>
                      setPoints((rows) => rows.filter((_, at) => at !== index))
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || points.length >= 30}
                onClick={() => setPoints((rows) => [...rows, { value: "" }])}
              >
                <Plus aria-hidden="true" />
                {t("estimates.addPoint")}
              </Button>
            </div>
          </div>
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
          {canManage ? (
            <div>
              <Button
                disabled={disabled}
                onClick={() => {
                  setProblem(null);
                  dryRun.mutate();
                }}
              >
                {t("estimates.review")}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("estimates.readOnly")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("estimates.policy.title")}</CardTitle>
          <CardDescription>{t("estimates.policy.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={estimate.incompletePolicy}
            disabled={!canManage || policy.isPending}
            onValueChange={(value) => policy.mutate(value as IncompletePolicy)}
            aria-label={t("estimates.policy.title")}
          >
            {INCOMPLETE_POLICIES.map((option) => (
              <div key={option} className="flex items-start gap-2">
                <RadioGroupItem
                  id={`policy-${option}`}
                  value={option}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`policy-${option}`}
                  className="flex flex-col gap-0.5 font-normal"
                >
                  <span className="font-medium">
                    {t(`complete.policy.${option}.label`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`complete.policy.${option}.description`)}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {preview ? (
        <EstimatePreviewDialog
          preview={preview}
          busy={apply.isPending}
          onCancel={() => setPreview(null)}
          onConfirm={() => apply.mutate(true)}
        />
      ) : null}
    </div>
  );
}

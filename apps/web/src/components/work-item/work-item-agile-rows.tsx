import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@taskdesk/ui";
import { Check, Layers, Repeat, Ruler } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { agileFieldsOf } from "@/components/agile/work-item-agile-fields";
import {
  FeatureDisabledError,
  getCycles,
  getModules,
  getWorkItemEstimate,
  setWorkItemCycle,
  setWorkItemEstimate,
  setWorkItemModule,
} from "@/fetchers/agile";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import useProjectEstimate from "@/hooks/queries/agile/use-project-estimate";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useRefreshWorkItem } from "./work-item-save";

type Option = { id: string; label: string };

/** The key's project slug: a work item key is `{slug}-{number}`. */
function projectKeyOf(itemKey: string) {
  return itemKey.replace(/-\d+$/u, "");
}

function PickerRow({
  testId,
  icon,
  label,
  trailing,
  options,
  currentId,
  noneLabel,
  canEdit,
  compact,
  busy,
  onChange,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  options: Option[];
  currentId: string | null;
  noneLabel: string;
  canEdit: boolean;
  compact: boolean;
  busy: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rowClass = cn(
    "h-7 justify-start gap-1.5 px-1.5",
    !compact && "lg:w-full",
  );
  const trigger = (
    <Button variant="ghost" size="sm" className={rowClass} data-testid={testId}>
      {icon}
      <span className="truncate font-semibold text-xs">{label}</span>
      {trailing}
    </Button>
  );
  if (!canEdit) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="max-h-64 overflow-y-auto">
          {[{ id: "", label: noneLabel }, ...options].map((option) => {
            const selected = (currentId ?? "") === option.id;
            return (
              <Button
                key={option.id || "none"}
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start gap-2 rounded-none px-2"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(option.id === "" ? null : option.id);
                }}
              >
                <span className="truncate text-sm">{option.label}</span>
                {selected ? <Check className="ml-auto size-4" /> : null}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type RowProps = { item: WorkItemDetailRow; compact: boolean };

function EstimateRow({ item, compact }: RowProps) {
  const { t } = useTranslation("workItems");
  const cache = useQueryClient();
  const refresh = useRefreshWorkItem(item);
  const projectKey = projectKeyOf(item.key);
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const scale = useProjectEstimate(projectKey);
  const current = useQuery({
    queryKey: ["agile", "work-item-estimate", item.key],
    queryFn: () => getWorkItemEstimate(item.key),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) && count < 2,
  });
  const save = useMutation({
    mutationFn: (pointId: string | null) =>
      setWorkItemEstimate(item.key, pointId),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await refresh();
    },
    onError: () => toast.error(t("properties.agile.saveFailed")),
  });
  if (!scale.data?.system) return null;
  const rollup = current.data?.rollup;
  const label = current.data?.point?.value ?? t("properties.agile.noEstimate");
  return (
    <PickerRow
      testId="work-item-estimate-control"
      icon={<Ruler className="size-4" aria-hidden="true" />}
      label={label}
      trailing={
        rollup && rollup.rollup !== null ? (
          <span
            className={cn(
              "font-normal text-muted-foreground text-xs",
              rollup.discrepancy && "text-warning-foreground",
            )}
            data-testid="work-item-estimate-rollup"
          >
            {rollup.own === null
              ? t("properties.agile.rollupOnly", { value: rollup.rollup })
              : t("properties.agile.rollupBeside", { value: rollup.rollup })}
          </span>
        ) : null
      }
      options={scale.data.points.map((point) => ({
        id: point.id,
        label: point.value,
      }))}
      currentId={current.data?.estimatePointId ?? null}
      noneLabel={t("properties.agile.noEstimate")}
      canEdit={canUpdateTasks()}
      compact={compact}
      busy={save.isPending}
      onChange={(id) => save.mutate(id)}
    />
  );
}

function CycleRow({ item, compact }: RowProps) {
  const { t } = useTranslation("workItems");
  const cache = useQueryClient();
  const refresh = useRefreshWorkItem(item);
  const projectKey = projectKeyOf(item.key);
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const cycles = useQuery({
    queryKey: ["agile", "cycles", projectKey],
    queryFn: () => getCycles(projectKey),
  });
  const currentId = agileFieldsOf(item).cycleId;
  const save = useMutation({
    mutationFn: (cycleId: string | null) => setWorkItemCycle(item.key, cycleId),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await refresh();
    },
    onError: () => toast.error(t("properties.agile.saveFailed")),
  });
  const list = cycles.data?.data ?? [];
  const current = list.find((cycle) => cycle.id === currentId);
  return (
    <PickerRow
      testId="work-item-cycle-control"
      icon={<Repeat className="size-4" aria-hidden="true" />}
      label={current?.name ?? t("properties.agile.noCycle")}
      options={list
        .filter(
          (cycle) => cycle.status !== "completed" || cycle.id === currentId,
        )
        .map((cycle) => ({ id: cycle.id, label: cycle.name }))}
      currentId={currentId}
      noneLabel={t("properties.agile.noCycle")}
      canEdit={canUpdateTasks() && cycles.isSuccess}
      compact={compact}
      busy={save.isPending}
      onChange={(id) => save.mutate(id)}
    />
  );
}

function ModuleRow({ item, compact }: RowProps) {
  const { t } = useTranslation("workItems");
  const cache = useQueryClient();
  const refresh = useRefreshWorkItem(item);
  const projectKey = projectKeyOf(item.key);
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const modules = useQuery({
    queryKey: ["agile", "modules", projectKey],
    queryFn: () => getModules(projectKey),
  });
  const currentId = agileFieldsOf(item).moduleId;
  const save = useMutation({
    mutationFn: (moduleId: string | null) =>
      setWorkItemModule(item.key, moduleId),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["agile"] });
      await refresh();
    },
    onError: () => toast.error(t("properties.agile.saveFailed")),
  });
  const list = modules.data?.data ?? [];
  const current = list.find((module) => module.id === currentId);
  return (
    <PickerRow
      testId="work-item-module-control"
      icon={<Layers className="size-4" aria-hidden="true" />}
      label={current?.name ?? t("properties.agile.noModule")}
      options={list.map((module) => ({ id: module.id, label: module.name }))}
      currentId={currentId}
      noneLabel={t("properties.agile.noModule")}
      canEdit={canUpdateTasks() && modules.isSuccess}
      compact={compact}
      busy={save.isPending}
      onChange={(id) => save.mutate(id)}
    />
  );
}

/**
 * `ES-2`, `ES-4`, `CY-4`, `MO-2`: the estimate, cycle and module property rows of the work item.
 * Each appears only while its feature resolves on for the project (all three default off), so a
 * support queue never sees them. An item is in at most one cycle and one module; the estimate is
 * a point of the project's scale and a parent shows its roll-up beside its own estimate.
 */
export default function WorkItemAgileRows({ item, compact }: RowProps) {
  const { features } = useAgileFeatures(item.projectId);
  return (
    <>
      {features.estimates ? (
        <EstimateRow item={item} compact={compact} />
      ) : null}
      {features.cycles ? <CycleRow item={item} compact={compact} /> : null}
      {features.modules ? <ModuleRow item={item} compact={compact} /> : null}
    </>
  );
}

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CostEntry,
  createProjectCost,
  requestCostEntryDeletion,
} from "@/fetchers/time-tracking";
import { useTimeTrackingFeatures } from "@/hooks/queries/time-tracking/use-time-tracking";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatMinor, parseMinor } from "@/lib/money-minor";
import { toast } from "@/lib/toast";
import type { WorkItemDetailRow } from "@/types/work-item";
import {
  CostEntryEditDialog,
  earliestCostDate,
} from "./cost-entry-edit-dialog";
import { isRefused, parseUnits, useProjectCosts } from "./cost-queries";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

/**
 * `TC-13`/`TC-14` cost entries on a work item (and its sub-items): what was bought, when, for whom.
 * Visible with `budget:read` while cost tracking is on. Amounts, totals and the quick-add exist
 * only for `time_entry:manage_rates` holders: everyone else sees units, type, person and date.
 */
export default function WorkItemCosts({ item }: { item: WorkItemDetailRow }) {
  const { t } = useTranslation();
  const message = useTimeErrorMessage();
  const invalidate = useInvalidateTime();
  const openPendingAction = useOpenPendingAction();
  const { canReadBudgets } = useWorkspacePermission();
  const features = useTimeTrackingFeatures(item.projectId);
  const visible = canReadBudgets() && features.cost;
  const costs = useProjectCosts(item.projectId, item.id, visible);
  const [editing, setEditing] = useState<CostEntry | null>(null);
  const [typePick, setTypePick] = useState<string | null>(null);
  const [units, setUnits] = useState("1");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [rate, setRate] = useState("");
  const list = costs.data;
  const types = list?.costTypes ?? [];
  const costType = types.find((type) => type.id === typePick) ?? types[0];
  const needsRate = costType !== undefined && costType.defaultRateMinor == null;
  const parsedUnits = parseUnits(units);
  const rateMinor =
    needsRate && costType ? parseMinor(rate, costType.currency) : null;
  const today = list?.today ?? "";

  const add = useMutation({
    mutationFn: () =>
      createProjectCost(item.projectId, {
        costTypeId: (costType as { id: string }).id,
        workItemId: item.id,
        date: date || today,
        units: parsedUnits as number,
        ...(needsRate ? { rateMinor: rateMinor as number } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      setUnits("1");
      setNote("");
      setRate("");
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  const remove = useMutation({
    mutationFn: (entry: CostEntry) => requestCostEntryDeletion(entry.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(message(error)),
  });

  if (!visible) return null;
  if (costs.isLoading) return <Skeleton className="h-12 w-full" />;
  // A refusal (feature switched off meanwhile, no reach) hides the section like the gate does.
  if (isRefused(costs.error)) return null;
  if (costs.isError || !list)
    return (
      <Alert variant="error">
        <AlertDescription>{t("timeTracking:costs.loadError")}</AlertDescription>
      </Alert>
    );

  const canSubmit =
    list.canManage &&
    costType !== undefined &&
    parsedUnits !== null &&
    (!needsRate || rateMinor !== null) &&
    !add.isPending;
  const earliest = earliestCostDate(
    list.canLogBackdated,
    list.today,
    list.backdateLimitDays,
  );

  return (
    <section
      className="space-y-3 border-t pt-3 text-sm"
      aria-labelledby="work-item-costs-title"
      data-testid="work-item-costs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="work-item-costs-title" className="font-medium">
          {t("timeTracking:costs.title")}
        </h3>
        <Badge variant="outline" className="tabular-nums">
          {t("timeTracking:costs.count", { count: list.entryCount })}
        </Badge>
        {(list.totals ?? []).map((total) => (
          <Badge
            key={total.currency}
            variant="outline"
            className="tabular-nums"
            data-testid="cost-total"
          >
            {formatMinor(total.amountMinor, total.currency)}
          </Badge>
        ))}
      </div>

      {list.canManage ? (
        types.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("timeTracking:costs.noTypes")}
          </p>
        ) : (
          <form
            className="grid grid-cols-2 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) add.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cost-type" className="text-xs">
                {t("timeTracking:costs.type")}
              </Label>
              <Select
                value={costType?.id ?? null}
                disabled={add.isPending}
                onValueChange={(next) => next && setTypePick(next)}
              >
                <SelectTrigger
                  id="cost-type"
                  aria-label={t("timeTracking:costs.type")}
                >
                  <SelectValue>{costType?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-units" className="text-xs">
                {t("timeTracking:costs.units", {
                  unit: costType?.unit ?? "",
                })}
              </Label>
              <Input
                id="cost-units"
                inputMode="numeric"
                value={units}
                aria-invalid={units !== "" && parsedUnits === null}
                disabled={add.isPending}
                onChange={(event) => setUnits(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-date" className="text-xs">
                {t("timeTracking:fields.date")}
              </Label>
              <DateField
                id="cost-date"
                value={date || today}
                max={today}
                min={earliest}
                disabled={add.isPending}
                onChange={setDate}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-note" className="text-xs">
                {t("timeTracking:costs.note")}
              </Label>
              <Input
                id="cost-note"
                maxLength={2000}
                value={note}
                disabled={add.isPending}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {needsRate && costType ? (
              <div className="space-y-1">
                <Label htmlFor="cost-rate" className="text-xs">
                  {t("timeTracking:costs.rate", {
                    currency: costType.currency,
                  })}
                </Label>
                <Input
                  id="cost-rate"
                  inputMode="decimal"
                  value={rate}
                  aria-invalid={rate !== "" && rateMinor === null}
                  disabled={add.isPending}
                  onChange={(event) => setRate(event.target.value)}
                />
              </div>
            ) : null}
            <div className="col-span-2 flex justify-end">
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {t("timeTracking:costs.add")}
              </Button>
            </div>
          </form>
        )
      ) : null}

      {list.data.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("timeTracking:costs.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("timeTracking:fields.date")}</TableHead>
              <TableHead>{t("timeTracking:costs.type")}</TableHead>
              <TableHead>{t("timeTracking:fields.person")}</TableHead>
              <TableHead className="text-right">
                {t("timeTracking:costs.unitsShort")}
              </TableHead>
              {list.canManage ? (
                <TableHead className="text-right">
                  {t("timeTracking:costs.amount")}
                </TableHead>
              ) : null}
              {list.canManage ? (
                <TableHead className="w-20">
                  <span className="sr-only">
                    {t("timeTracking:entry.actions")}
                  </span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.map((entry) => (
              <TableRow key={entry.id} data-testid="cost-entry-row">
                <TableCell className="whitespace-nowrap tabular-nums">
                  {entry.date}
                </TableCell>
                <TableCell>
                  <span>{entry.costTypeName}</span>
                  {!entry.billable ? (
                    <Badge variant="outline" className="ml-1">
                      {t("timeTracking:entry.nonBillable")}
                    </Badge>
                  ) : null}
                  {entry.workItemKey && entry.workItemId !== item.id ? (
                    <span className="ml-1 text-muted-foreground text-xs">
                      {entry.workItemKey}
                    </span>
                  ) : null}
                  {entry.note ? (
                    <span className="block text-muted-foreground text-xs">
                      {entry.note}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{entry.personName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {entry.units} {entry.unit}
                </TableCell>
                {list.canManage ? (
                  <TableCell className="text-right tabular-nums">
                    {entry.amountMinor === undefined
                      ? null
                      : formatMinor(entry.amountMinor, entry.currency)}
                  </TableCell>
                ) : null}
                {list.canManage ? (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("timeTracking:costs.edit")}
                        onClick={() => setEditing(entry)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("timeTracking:costs.delete")}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(entry)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing ? (
        <CostEntryEditDialog
          entry={editing}
          today={list.today}
          earliestDate={earliest}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

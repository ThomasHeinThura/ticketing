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
  Input,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CostType,
  createCostType,
  TimeTrackingDisabledError,
  updateCostType,
} from "@/fetchers/time-tracking";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatMinor, parseMinor } from "@/lib/money-minor";
import { toast } from "@/lib/toast";
import { isRefused, plainMajor, useCostTypes } from "./cost-queries";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

const CURRENCY = /^[A-Z]{3}$/u;

/** A blank rate means "each entry states its own"; anything else must be an amount. */
function rateOf(amount: string, currency: string): number | null | undefined {
  if (amount.trim() === "") return null;
  if (!CURRENCY.test(currency)) return undefined;
  return parseMinor(amount, currency) ?? undefined;
}

function CostTypeFields({
  idPrefix,
  name,
  unit,
  amount,
  currency,
  billable,
  disabled,
  onChange,
  autoFocus,
}: {
  idPrefix: string;
  name: string;
  unit: string;
  amount: string;
  currency: string;
  billable: boolean;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (
    changes: Partial<{
      name: string;
      unit: string;
      amount: string;
      currency: string;
      billable: boolean;
    }>,
  ) => void;
}) {
  const { t } = useTranslation();
  const rate = rateOf(amount, currency);
  return (
    <>
      <div className="w-48 space-y-1">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          {t("timeTracking:costTypes.name")}
        </Label>
        <Input
          id={`${idPrefix}-name`}
          autoFocus={autoFocus}
          maxLength={80}
          value={name}
          disabled={disabled}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="w-28 space-y-1">
        <Label htmlFor={`${idPrefix}-unit`} className="text-xs">
          {t("timeTracking:costTypes.unit")}
        </Label>
        <Input
          id={`${idPrefix}-unit`}
          maxLength={40}
          placeholder={t("timeTracking:costTypes.unitPlaceholder")}
          value={unit}
          disabled={disabled}
          onChange={(event) => onChange({ unit: event.target.value })}
        />
      </div>
      <div className="w-32 space-y-1">
        <Label htmlFor={`${idPrefix}-rate`} className="text-xs">
          {t("timeTracking:costTypes.defaultRate")}
        </Label>
        <Input
          id={`${idPrefix}-rate`}
          inputMode="decimal"
          value={amount}
          aria-invalid={rate === undefined}
          disabled={disabled}
          onChange={(event) => onChange({ amount: event.target.value })}
        />
      </div>
      <div className="w-24 space-y-1">
        <Label htmlFor={`${idPrefix}-currency`} className="text-xs">
          {t("timeTracking:rates.currency")}
        </Label>
        <Input
          id={`${idPrefix}-currency`}
          maxLength={3}
          placeholder="EUR"
          value={currency}
          aria-invalid={currency !== "" && !CURRENCY.test(currency)}
          disabled={disabled}
          onChange={(event) =>
            onChange({ currency: event.target.value.toUpperCase() })
          }
        />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch
          id={`${idPrefix}-billable`}
          checked={billable}
          disabled={disabled}
          onCheckedChange={(next) => onChange({ billable: next })}
        />
        <Label htmlFor={`${idPrefix}-billable`} className="text-xs">
          {t("timeTracking:fields.billable")}
        </Label>
      </div>
    </>
  );
}

function CostTypeEditDialog({
  costType,
  workspaceId,
  onClose,
}: {
  costType: CostType;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [draft, setDraft] = useState({
    name: costType.name,
    unit: costType.unit,
    amount:
      costType.defaultRateMinor == null
        ? ""
        : plainMajor(costType.defaultRateMinor, costType.currency),
    currency: costType.currency,
    billable: costType.billable,
  });
  const rate = rateOf(draft.amount, draft.currency);
  const valid =
    draft.name.trim() !== "" &&
    draft.unit.trim() !== "" &&
    CURRENCY.test(draft.currency) &&
    rate !== undefined;
  const changes = {
    ...(draft.name.trim() !== costType.name ? { name: draft.name.trim() } : {}),
    ...(draft.unit.trim() !== costType.unit ? { unit: draft.unit.trim() } : {}),
    ...(rate !== undefined && rate !== (costType.defaultRateMinor ?? null)
      ? { defaultRateMinor: rate }
      : {}),
    ...(draft.currency !== costType.currency
      ? { currency: draft.currency }
      : {}),
    ...(draft.billable !== costType.billable
      ? { billable: draft.billable }
      : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  const save = useMutation({
    mutationFn: () => updateCostType(costType.id, workspaceId, changes),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("timeTracking:costTypes.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("timeTracking:costTypes.snapshotNote")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && dirty && !save.isPending) save.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3 px-6">
            <CostTypeFields
              idPrefix="cost-type-edit"
              autoFocus
              {...draft}
              disabled={save.isPending}
              onChange={(changes) =>
                setDraft((current) => ({ ...current, ...changes }))
              }
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={save.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || !dirty || save.isPending}>
              {t("timeTracking:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CostTypeRow({
  costType,
  workspaceId,
  onEdit,
}: {
  costType: CostType;
  workspaceId: string;
  onEdit: (costType: CostType) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      updateCostType(costType.id, workspaceId, { archived }),
    onSuccess: invalidate,
    onError: (error) => toast.error(message(error)),
  });
  return (
    <TableRow data-testid="cost-type-row">
      <TableCell>
        <span className="font-medium">{costType.name}</span>
        {costType.archived ? (
          <Badge variant="outline" className="ml-2">
            {t("timeTracking:activities.archived")}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>{costType.unit}</TableCell>
      <TableCell className="text-right tabular-nums">
        {costType.defaultRateMinor == null
          ? t("timeTracking:costTypes.noDefaultRate")
          : formatMinor(costType.defaultRateMinor, costType.currency)}
      </TableCell>
      <TableCell>
        {costType.billable
          ? t("timeTracking:fields.billable")
          : t("timeTracking:entry.nonBillable")}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("timeTracking:costTypes.edit", {
              name: costType.name,
            })}
            onClick={() => onEdit(costType)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={archive.isPending}
            aria-label={t(
              costType.archived
                ? "timeTracking:costTypes.restoreLabel"
                : "timeTracking:costTypes.archiveLabel",
              { name: costType.name },
            )}
            onClick={() => archive.mutate(!costType.archived)}
          >
            {costType.archived
              ? t("timeTracking:costTypes.restore")
              : t("timeTracking:costTypes.archive")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CostTypeAddForm({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [draft, setDraft] = useState({
    name: "",
    unit: "",
    amount: "",
    currency: "",
    billable: true,
  });
  const rate = rateOf(draft.amount, draft.currency);
  const valid =
    draft.name.trim() !== "" &&
    CURRENCY.test(draft.currency) &&
    rate !== undefined;
  const add = useMutation({
    mutationFn: () =>
      createCostType({
        workspaceId,
        name: draft.name.trim(),
        unit: draft.unit.trim() || "unit",
        defaultRateMinor: rate as number | null,
        currency: draft.currency,
        billable: draft.billable,
      }),
    onSuccess: async () => {
      setDraft((current) => ({
        ...current,
        name: "",
        unit: "",
        amount: "",
      }));
      toast.success(t("timeTracking:costTypes.added"));
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message.includes("already exists")
          ? t("timeTracking:costTypes.duplicate")
          : message(error),
      ),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !add.isPending) add.mutate();
      }}
    >
      <CostTypeFields
        idPrefix="cost-type-new"
        {...draft}
        disabled={add.isPending}
        onChange={(changes) =>
          setDraft((current) => ({ ...current, ...changes }))
        }
      />
      <Button type="submit" disabled={!valid || add.isPending}>
        <Plus aria-hidden="true" />
        {t("timeTracking:costTypes.add")}
      </Button>
    </form>
  );
}

/**
 * `TC-12` cost types, on the Rates screen: what can be bought and logged (a seat, a kilometre, a
 * licence), its unit, default rate, currency and billable default. Same `time_entry:manage_rates`
 * gate as the hourly rates above; archiving hides a type from new entries only.
 */
export function CostTypesSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { canManageRates, isCheckingPermissions } = useWorkspacePermission();
  const allowed = canManageRates() && !isCheckingPermissions;
  const costTypes = useCostTypes(workspaceId, allowed);
  const [editing, setEditing] = useState<CostType | null>(null);
  if (!allowed) return null;
  return (
    <section
      className="space-y-4"
      aria-labelledby="cost-types-title"
      data-testid="cost-types-section"
    >
      <div className="space-y-1">
        <h2 id="cost-types-title" className="font-semibold text-xl">
          {t("timeTracking:costTypes.title")}
        </h2>
        <p className="max-w-2xl text-muted-foreground text-sm">
          {t("timeTracking:costTypes.description")}
        </p>
      </div>
      {costTypes.isLoading ? (
        <Skeleton className="h-24 w-full" role="status" />
      ) : costTypes.error instanceof TimeTrackingDisabledError ? (
        <Alert variant="info">
          <AlertTitle>{t("timeTracking:rates.disabledTitle")}</AlertTitle>
          <AlertDescription>
            {t("timeTracking:rates.disabledDescription")}
          </AlertDescription>
        </Alert>
      ) : isRefused(costTypes.error) ? (
        <Alert variant="error">
          <AlertTitle>{t("timeTracking:rates.forbiddenTitle")}</AlertTitle>
          <AlertDescription>
            {t("timeTracking:rates.forbiddenDescription")}
          </AlertDescription>
        </Alert>
      ) : costTypes.isError || !costTypes.data ? (
        <Alert variant="error">
          <AlertTitle>{t("timeTracking:costTypes.loadError")}</AlertTitle>
        </Alert>
      ) : (
        <>
          <CostTypeAddForm workspaceId={workspaceId} />
          {costTypes.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("timeTracking:costTypes.empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("timeTracking:costTypes.name")}</TableHead>
                  <TableHead>{t("timeTracking:costTypes.unit")}</TableHead>
                  <TableHead className="text-right">
                    {t("timeTracking:costTypes.defaultRate")}
                  </TableHead>
                  <TableHead>{t("timeTracking:fields.billable")}</TableHead>
                  <TableHead className="w-44">
                    <span className="sr-only">
                      {t("timeTracking:entry.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costTypes.data.map((costType) => (
                  <CostTypeRow
                    key={costType.id}
                    costType={costType}
                    workspaceId={workspaceId}
                    onEdit={setEditing}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {editing ? (
            <CostTypeEditDialog
              key={editing.id}
              costType={editing}
              workspaceId={workspaceId}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

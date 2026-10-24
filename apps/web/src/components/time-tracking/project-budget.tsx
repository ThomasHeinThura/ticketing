import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ProjectBudget as Budget,
  createProjectBudget,
  TimeTrackingDisabledError,
} from "@/fetchers/time-tracking";
import { useProjectBudget } from "@/hooks/queries/time-tracking/use-time-tracking";
import { formatMinor, parseMinor } from "@/lib/money-minor";
import { formatMinutes } from "@/lib/time-minutes";
import { toast } from "@/lib/toast";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

/** Whole-number percentage of planned spent, from integers (no float money). */
export function percentSpent(
  plannedMinor: number,
  actualMinor: number,
): number {
  if (plannedMinor <= 0) return actualMinor > 0 ? 100 : 0;
  return Math.min(100, Math.floor((actualMinor * 100) / plannedMinor));
}

function BudgetCard({ budget }: { budget: Budget }) {
  const { t } = useTranslation();
  const hidden = budget.figuresHidden || budget.actualMinor === undefined;
  const actualMinor = budget.actualMinor ?? 0;
  const percent = hidden
    ? 0
    : percentSpent(budget.plannedAmountMinor, actualMinor);
  const hiddenText = t("timeTracking:budget.figuresHidden");
  return (
    <Card data-testid="budget-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {budget.name}
          {!hidden && budget.thresholdReached ? (
            <Badge
              variant={budget.thresholdReached === 90 ? "error" : "warning"}
            >
              {t("timeTracking:budget.threshold", {
                percent: budget.thresholdReached,
              })}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {budget.periodStart} – {budget.periodEnd}
        </CardDescription>
      </CardHeader>
      <div className="space-y-3 px-6 pb-6 text-sm">
        {hidden ? null : (
          <Progress value={percent} aria-label={t("timeTracking:budget.spent")}>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("timeTracking:budget.planned")}
            </dt>
            <dd className="tabular-nums">
              {formatMinor(budget.plannedAmountMinor, budget.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("timeTracking:budget.actual")}
            </dt>
            <dd className="tabular-nums">
              {hidden ? hiddenText : formatMinor(actualMinor, budget.currency)}
            </dd>
            {!hidden &&
            (budget.timeMinor !== undefined ||
              budget.costEntriesMinor !== undefined) ? (
              <dd
                className="text-muted-foreground text-xs tabular-nums"
                data-testid="budget-actual-split"
              >
                {t("timeTracking:budget.actualSplit", {
                  time: formatMinor(budget.timeMinor ?? 0, budget.currency),
                  cost: formatMinor(
                    budget.costEntriesMinor ?? 0,
                    budget.currency,
                  ),
                })}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("timeTracking:budget.remaining")}
            </dt>
            <dd className="tabular-nums">
              {hidden || budget.remainingMinor === undefined
                ? hiddenText
                : formatMinor(budget.remainingMinor, budget.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">
              {t("timeTracking:budget.committed")}
            </dt>
            <dd>
              {budget.committedMinor === null
                ? t("timeTracking:budget.committedUnavailable")
                : formatMinor(budget.committedMinor, budget.currency)}
            </dd>
          </div>
        </dl>
        {(budget.otherCurrencies?.length ?? 0) > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("timeTracking:budget.otherCurrencies", {
              amounts: (budget.otherCurrencies ?? [])
                .map((row) => formatMinor(row.costMinor, row.currency))
                .join(", "),
            })}
          </p>
        ) : null}
        {(budget.unpricedMinutes ?? 0) > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("timeTracking:budget.unpriced", {
              time: formatMinutes(budget.unpricedMinutes ?? 0),
            })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function CreateBudgetForm({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const code = currency.toUpperCase();
  const minor = /^[A-Z]{3}$/u.test(code) ? parseMinor(amount, code) : null;
  const valid =
    name.trim() !== "" &&
    minor !== null &&
    periodStart !== "" &&
    periodEnd !== "" &&
    periodEnd >= periodStart;
  const create = useMutation({
    mutationFn: () =>
      createProjectBudget(projectId, {
        name: name.trim(),
        plannedAmountMinor: minor as number,
        currency: code,
        periodStart,
        periodEnd,
      }),
    onSuccess: async () => {
      setName("");
      setAmount("");
      toast.success(t("timeTracking:budget.created"));
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !create.isPending) create.mutate();
      }}
    >
      <div className="w-48 space-y-1">
        <Label htmlFor="budget-name" className="text-xs">
          {t("timeTracking:budget.name")}
        </Label>
        <Input
          id="budget-name"
          maxLength={120}
          value={name}
          disabled={create.isPending}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="w-32 space-y-1">
        <Label htmlFor="budget-amount" className="text-xs">
          {t("timeTracking:budget.planned")}
        </Label>
        <Input
          id="budget-amount"
          inputMode="decimal"
          value={amount}
          aria-invalid={amount !== "" && minor === null}
          disabled={create.isPending}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="w-24 space-y-1">
        <Label htmlFor="budget-currency" className="text-xs">
          {t("timeTracking:rates.currency")}
        </Label>
        <Input
          id="budget-currency"
          maxLength={3}
          placeholder="EUR"
          value={currency}
          disabled={create.isPending}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
      </div>
      <div className="w-40 space-y-1">
        <Label htmlFor="budget-start" className="text-xs">
          {t("timeTracking:budget.periodStart")}
        </Label>
        <DateField
          id="budget-start"
          value={periodStart || "—"}
          disabled={create.isPending}
          onChange={setPeriodStart}
        />
      </div>
      <div className="w-40 space-y-1">
        <Label htmlFor="budget-end" className="text-xs">
          {t("timeTracking:budget.periodEnd")}
        </Label>
        <DateField
          id="budget-end"
          value={periodEnd || "—"}
          min={periodStart || undefined}
          disabled={create.isPending}
          onChange={setPeriodEnd}
        />
      </div>
      <Button type="submit" disabled={!valid || create.isPending}>
        <Plus aria-hidden="true" />
        {t("timeTracking:budget.create")}
      </Button>
    </form>
  );
}

/**
 * `docs/screens.md` "Project — budget" (P5, `TC-15`..`TC-19`): planned versus actual per budget
 * period, other currencies reported apart and never converted. The minutes breakdowns appear only
 * for callers who may also see rates (minutes next to a cost total would reveal one).
 */
export function ProjectBudget({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const budget = useProjectBudget(projectId);
  if (budget.isLoading)
    return <Skeleton className="h-32 w-full" role="status" />;
  if (budget.error instanceof TimeTrackingDisabledError)
    return (
      <Alert variant="info">
        <AlertTitle>{t("timeTracking:budget.disabledTitle")}</AlertTitle>
        <AlertDescription>
          {t("timeTracking:budget.disabledDescription")}
        </AlertDescription>
      </Alert>
    );
  if (
    (budget.error as { status?: number } | null)?.status === 403 ||
    (budget.error as { status?: number } | null)?.status === 404
  )
    return (
      <Alert variant="error">
        <AlertTitle>{t("timeTracking:budget.forbiddenTitle")}</AlertTitle>
        <AlertDescription>
          {t("timeTracking:budget.forbiddenDescription")}
        </AlertDescription>
      </Alert>
    );
  if (budget.isError || !budget.data)
    return (
      <Alert variant="error">
        <AlertTitle>{t("timeTracking:budget.loadError")}</AlertTitle>
        <AlertDescription>
          <Button className="w-fit" onClick={() => void budget.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  const data = budget.data;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold text-xl">
          {t("timeTracking:budget.title")}
        </h2>
        <p className="max-w-2xl text-muted-foreground text-sm">
          {t("timeTracking:budget.description")}
        </p>
      </div>
      {data.canManage ? <CreateBudgetForm projectId={projectId} /> : null}
      {data.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("timeTracking:budget.empty")}
        </p>
      ) : (
        <CardFrame>
          {data.data.map((entry) => (
            <BudgetCard key={entry.id} budget={entry} />
          ))}
        </CardFrame>
      )}
      {data.byActivity.length > 0 || data.byPerson.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { key: "activity", rows: data.byActivity },
            { key: "person", rows: data.byPerson },
          ].map(({ key, rows }) => (
            <Table key={key} data-testid={`budget-by-${key}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(`timeTracking:budget.by.${key}`)}</TableHead>
                  <TableHead className="text-right">
                    {t("timeTracking:fields.duration")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(row.minutes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
        </div>
      ) : null}
    </div>
  );
}

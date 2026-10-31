import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  Skeleton,
} from "@taskdesk/ui";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/common/date-field";
import {
  type ContractCoverage,
  type ContractInput,
  getProjectContract,
  type KickoffStatus,
  type ProjectContract,
  projectOverviewKeys,
  putProjectContract,
} from "@/fetchers/project/overview";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  CONTRACT_STATE_VARIANT,
  formatDate,
  formatHours,
  OptionSelect,
  Panel,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

const COVERAGES: ContractCoverage[] = ["9x5", "12x5", "24x7"];
const KICKOFFS: KickoffStatus[] = ["pending", "scheduled", "completed"];

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{children}</dd>
    </div>
  );
}

/**
 * D2 contract and hour bank (`GET`/`PUT /api/project/{id}/contract`). Reading needs
 * `project:read`; the Add/Edit control is offered only with `project:manage_settings`.
 */
export function ContractPanel({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation("projectOverview");
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: projectOverviewKeys.contract(projectId),
    queryFn: () => getProjectContract(projectId),
    // Hours used come from time entries logged elsewhere; refetch on every visit.
    refetchOnMount: "always",
  });
  const data = query.data;
  const contract = data?.contract ?? null;
  const locale = i18n.language;

  return (
    <Panel
      title={t("contract.title")}
      testId="project-contract-panel"
      actions={
        canManage && data ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            data-testid="project-contract-edit"
          >
            {contract ? (
              <Pencil aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {contract ? t("contract.edit") : t("contract.add")}
          </Button>
        ) : null
      }
    >
      {query.isLoading ? (
        <div role="status" aria-label={t("loading")} className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-2 w-full" />
        </div>
      ) : query.isError || !data ? (
        <p className="text-destructive-foreground text-sm">
          {t("contract.loadFailed")}
        </p>
      ) : !contract || !data.hourBank ? (
        <p className="text-muted-foreground text-sm">{t("contract.none")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={CONTRACT_STATE_VARIANT[data.state] ?? "outline"}>
              {t(`contract.state.${data.state}`)}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {data.daysRemaining !== null && data.daysRemaining >= 0
                ? t("contract.daysLeft", { count: data.daysRemaining })
                : t("contract.endedOn", {
                    date: formatDate(contract.endDate, locale),
                  })}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm">
                {t("contract.hourBank")}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("contract.usedOf", {
                  used: formatHours(data.hourBank.usedMinutes, locale),
                  contracted: formatHours(
                    data.hourBank.contractedMinutes,
                    locale,
                  ),
                })}
              </span>
            </div>
            <Progress
              value={Math.min(100, data.hourBank.usedPct)}
              aria-label={t("contract.hourBank")}
            >
              <ProgressTrack>
                <ProgressIndicator
                  className={cn(
                    data.hourBank.usedPct >= 100
                      ? "bg-destructive"
                      : data.hourBank.usedPct >= 80
                        ? "bg-warning"
                        : undefined,
                  )}
                />
              </ProgressTrack>
            </Progress>
            <span
              className={cn(
                "text-xs tabular-nums",
                data.hourBank.remainingMinutes < 0
                  ? "text-destructive-foreground"
                  : "text-muted-foreground",
              )}
            >
              {data.hourBank.remainingMinutes < 0
                ? t("contract.overdrawn", {
                    hours: formatHours(-data.hourBank.remainingMinutes, locale),
                  })
                : t("contract.remaining", {
                    hours: formatHours(data.hourBank.remainingMinutes, locale),
                  })}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <Fact label={t("contract.period")}>
              {formatDate(contract.startDate, locale)} –{" "}
              {formatDate(contract.endDate, locale)}
            </Fact>
            <Fact label={t("contract.coverage")}>
              {t(`contract.coverageOption.${contract.coverage}`)}
            </Fact>
            <Fact label={t("contract.kickoff")}>
              {t(`contract.kickoffStatus.${contract.kickoffStatus}`)}
              {contract.kickoffDate
                ? ` · ${formatDate(contract.kickoffDate, locale)}`
                : ""}
            </Fact>
          </dl>
          {/* Individual entries need time_entry:read_any; without it the API withholds them,
              so the block is left out rather than claiming there is no time. */}
          {data.recentEntriesVisible ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-xs">
                {t("contract.recent")}
              </span>
              {data.recentEntries.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("contract.noRecent")}
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {data.recentEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-2 py-1.5 text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {formatDate(entry.date, locale)}
                        {entry.workItemKey ? ` · ${entry.workItemKey}` : ""}
                      </span>
                      <span className="tabular-nums">
                        {t("contract.hours", {
                          hours: formatHours(entry.minutes, locale),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
      {editing && data ? (
        <ContractDialog
          projectId={projectId}
          contract={data.contract}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Panel>
  );
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ContractDialog({
  projectId,
  contract,
  onClose,
}: {
  projectId: string;
  contract: ProjectContract["contract"];
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [startDate, setStartDate] = useState(contract?.startDate ?? todayIso());
  const [endDate, setEndDate] = useState(contract?.endDate ?? "");
  const [hours, setHours] = useState(
    contract ? String(contract.contractedMinutes / 60) : "",
  );
  const [coverage, setCoverage] = useState<ContractCoverage>(
    (contract?.coverage as ContractCoverage | undefined) ?? "9x5",
  );
  const [kickoffStatus, setKickoffStatus] = useState<KickoffStatus>(
    (contract?.kickoffStatus as KickoffStatus | undefined) ?? "pending",
  );
  const [kickoffDate, setKickoffDate] = useState(contract?.kickoffDate ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const parsedHours = Number(hours.replace(",", "."));
  const minutes = Math.round(parsedHours * 60);
  const hoursValid =
    hours.trim() !== "" &&
    Number.isFinite(parsedHours) &&
    minutes >= 1 &&
    minutes <= 60_000_000;
  const datesValid = Boolean(startDate && endDate) && endDate >= startDate;
  const dateError =
    startDate && endDate && endDate < startDate
      ? t("contract.dialog.endBeforeStart")
      : null;

  const save = useMutation({
    mutationFn: () => {
      const body: ContractInput = {
        startDate,
        endDate,
        contractedMinutes: minutes,
        coverage,
        kickoffStatus,
        kickoffDate: kickoffDate || null,
      };
      return putProjectContract(projectId, body);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(t("contract.dialog.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });

  const dateEntry = (label: string) => ({
    label: t("common:dateEntry", { label }),
    invalidLabel: t("common:invalidDate"),
    saveLabel: t("common.save"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-lg" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {contract
              ? t("contract.dialog.editTitle")
              : t("contract.dialog.addTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("contract.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-start">
                {t("contract.dialog.start")}
              </Label>
              <DateField
                id="contract-start"
                placeholder={t("common.pickDate")}
                label={t("contract.dialog.start")}
                value={startDate}
                onChange={setStartDate}
                disabled={save.isPending}
                dateEntry={dateEntry(t("contract.dialog.start"))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-end">{t("contract.dialog.end")}</Label>
              <DateField
                id="contract-end"
                placeholder={t("common.pickDate")}
                label={t("contract.dialog.end")}
                value={endDate}
                onChange={setEndDate}
                min={startDate || undefined}
                disabled={save.isPending}
                aria-invalid={dateError ? true : undefined}
                dateEntry={dateEntry(t("contract.dialog.end"))}
              />
            </div>
          </div>
          {dateError ? (
            <p className="text-destructive-foreground text-xs" role="alert">
              {dateError}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-hours">{t("contract.dialog.hours")}</Label>
            <Input
              id="contract-hours"
              inputMode="decimal"
              value={hours}
              aria-invalid={hours !== "" && !hoursValid ? true : undefined}
              aria-describedby="contract-hours-hint"
              onChange={(event) => setHours(event.target.value)}
              className="sm:w-40"
            />
            <p
              id="contract-hours-hint"
              className={cn(
                "text-xs",
                hours !== "" && !hoursValid
                  ? "text-destructive-foreground"
                  : "text-muted-foreground",
              )}
            >
              {hours !== "" && !hoursValid
                ? t("contract.dialog.hoursInvalid")
                : t("contract.dialog.hoursHint")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-coverage">
                {t("contract.coverage")}
              </Label>
              <OptionSelect
                id="contract-coverage"
                value={coverage}
                options={COVERAGES.map((value) => ({
                  value,
                  label: t(`contract.coverageOption.${value}`),
                }))}
                onChange={setCoverage}
                disabled={save.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contract-kickoff">
                {t("contract.dialog.kickoffStatus")}
              </Label>
              <OptionSelect
                id="contract-kickoff"
                value={kickoffStatus}
                options={KICKOFFS.map((value) => ({
                  value,
                  label: t(`contract.kickoffStatus.${value}`),
                }))}
                onChange={setKickoffStatus}
                disabled={save.isPending}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contract-kickoff-date">
              {t("contract.dialog.kickoffDate")}
            </Label>
            <DateField
              id="contract-kickoff-date"
              placeholder={t("common.pickDate")}
              label={t("contract.dialog.kickoffDate")}
              value={kickoffDate}
              onChange={setKickoffDate}
              clearLabel={t("contract.dialog.clearDate")}
              disabled={save.isPending}
              dateEntry={dateEntry(t("contract.dialog.kickoffDate"))}
            />
          </div>
          {problem ? (
            <Alert variant="error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!datesValid || !hoursValid || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {t("contract.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

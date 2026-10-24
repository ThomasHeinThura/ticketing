import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
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
  createAvailableHours,
  updateTimeSettings,
} from "@/fetchers/time-tracking";
import { useTimeSettings } from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatMinutes } from "@/lib/time-minutes";
import { toast } from "@/lib/toast";
import { parseHoursPerWeek, useAvailableHours } from "./cost-queries";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

/** TC-4: how many days back people may log time without `time_entry:log_backdated`. */
export function BackdateLimitSetting() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const settings = useTimeSettings(workspace?.id);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(settings.data?.backdateLimitDays ?? "");
  const days = /^\d{1,4}$/u.test(value) ? Number(value) : null;
  const valid = days !== null && days <= 3650;
  const save = useMutation({
    mutationFn: () =>
      updateTimeSettings({
        workspaceId: workspace?.id as string,
        backdateLimitDays: days as number,
      }),
    onSuccess: async () => {
      setDraft(null);
      toast.success(t("timeTracking:settings.saved"));
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  if (!settings.data) return null;
  const dirty = draft !== null && days !== settings.data.backdateLimitDays;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && valid && !save.isPending) save.mutate();
      }}
    >
      <div className="w-56 space-y-1">
        <Label htmlFor="backdate-limit" className="text-xs">
          {t("timeTracking:settings.backdateLimit")}
        </Label>
        <Input
          id="backdate-limit"
          inputMode="numeric"
          value={value}
          aria-invalid={!valid}
          disabled={!settings.data.canManage || save.isPending}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      {settings.data.canManage ? (
        <Button type="submit" disabled={!dirty || !valid || save.isPending}>
          {t("timeTracking:actions.save")}
        </Button>
      ) : null}
      <p className="basis-full text-muted-foreground text-xs">
        {t("timeTracking:settings.backdateHelp")}
      </p>
    </form>
  );
}

/** TC-3: the billable default for time logged on one project. */
export function ProjectBillableSetting({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const settings = useTimeSettings(workspace?.id, projectId);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const save = useMutation({
    mutationFn: (defaultBillable: boolean) =>
      updateTimeSettings({
        workspaceId: workspace?.id as string,
        project: { id: projectId, defaultBillable },
      }),
    onSuccess: async () => {
      toast.success(t("timeTracking:settings.saved"));
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  const project = settings.data?.project;
  if (!settings.data || !project) return null;
  return (
    <div className="flex items-center gap-3">
      <Switch
        id="project-default-billable"
        checked={project.defaultBillable}
        disabled={!settings.data.canManage || save.isPending}
        onCheckedChange={(next) => save.mutate(next)}
      />
      <div className="space-y-0.5">
        <Label htmlFor="project-default-billable">
          {t("timeTracking:settings.defaultBillable")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("timeTracking:settings.defaultBillableHelp")}
        </p>
      </div>
    </div>
  );
}

/**
 * `TC-20` available hours: each person's capacity per week with the date it starts. History is
 * append-only, so changing someone's hours adds a row. Shown only to `workspace:manage_settings`
 * holders (the screen's own `canManage`); capacity feeds reports, it never assigns work.
 */
export function AvailableHoursSetting() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const settings = useTimeSettings(workspace?.id);
  const allowed = settings.data?.canManage === true;
  const hours = useAvailableHours(workspace?.id, allowed);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [personPick, setPersonPick] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const data = hours.data;
  const people = data?.people ?? [];
  const personId =
    personPick ??
    people.find((person) => person.personId === data?.callerPersonId)
      ?.personId ??
    people[0]?.personId ??
    null;
  const chosen = people.find((person) => person.personId === personId);
  const minutes = parseHoursPerWeek(amount);
  const canSubmit = personId !== null && minutes !== null;
  const add = useMutation({
    mutationFn: () =>
      createAvailableHours({
        workspaceId: workspace?.id as string,
        personId: personId as string,
        minutesPerWeek: minutes as number,
        effectiveFrom: effectiveFrom || today,
      }),
    onSuccess: async () => {
      setAmount("");
      toast.success(t("timeTracking:availableHours.added"));
      await invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message.includes("already start")
          ? t("timeTracking:availableHours.duplicate")
          : message(error),
      ),
  });
  if (!allowed || !data?.canManage) return null;
  const rows = [...data.data].sort(
    (a, b) =>
      (a.personName ?? a.personId).localeCompare(b.personName ?? b.personId) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  return (
    <section
      className="space-y-4"
      aria-labelledby="available-hours-title"
      data-testid="available-hours"
    >
      <div className="space-y-1">
        <h2 id="available-hours-title" className="font-semibold text-xl">
          {t("timeTracking:availableHours.title")}
        </h2>
        <p className="max-w-2xl text-muted-foreground text-sm">
          {t("timeTracking:availableHours.description")}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !add.isPending) add.mutate();
        }}
      >
        <div className="w-48 space-y-1">
          <Label htmlFor="available-hours-person" className="text-xs">
            {t("timeTracking:fields.person")}
          </Label>
          <Select
            value={personId}
            disabled={add.isPending}
            onValueChange={(next) => next && setPersonPick(next)}
          >
            <SelectTrigger
              id="available-hours-person"
              aria-label={t("timeTracking:fields.person")}
            >
              <SelectValue>
                {chosen?.name ?? t("timeTracking:rates.choosePerson")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.personId} value={person.personId}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32 space-y-1">
          <Label htmlFor="available-hours-amount" className="text-xs">
            {t("timeTracking:availableHours.hoursPerWeek")}
          </Label>
          <Input
            id="available-hours-amount"
            inputMode="decimal"
            placeholder="40"
            value={amount}
            aria-invalid={amount !== "" && minutes === null}
            disabled={add.isPending}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="w-44 space-y-1">
          <Label htmlFor="available-hours-from" className="text-xs">
            {t("timeTracking:rates.effectiveFrom")}
          </Label>
          <DateField
            id="available-hours-from"
            value={effectiveFrom || today}
            disabled={add.isPending}
            onChange={setEffectiveFrom}
          />
        </div>
        <Button type="submit" disabled={!canSubmit || add.isPending}>
          <Plus aria-hidden="true" />
          {t("timeTracking:availableHours.add")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("timeTracking:availableHours.empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("timeTracking:fields.person")}</TableHead>
              <TableHead className="text-right">
                {t("timeTracking:availableHours.hoursPerWeek")}
              </TableHead>
              <TableHead>{t("timeTracking:rates.effectiveFrom")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid="available-hours-row">
                <TableCell>{row.personName ?? row.personId}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMinutes(row.minutesPerWeek)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.effectiveFrom}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

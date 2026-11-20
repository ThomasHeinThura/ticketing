import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Input,
  Label,
  SaveButton,
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
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import {
  HistoryPresentation,
  SettingsHistory,
} from "@/components/settings/settings-history";
import {
  getSettingsHistory,
  settingsHistoryQueryKey,
} from "@/fetchers/settings/settings-history";
import {
  createAvailableHours,
  getTimeSettings,
  updateTimeSettings,
} from "@/fetchers/time-tracking";
import {
  useTimeEntries,
  useTimeSettings,
} from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { authClient } from "@/lib/auth-client";
import { HttpError } from "@/lib/http-error";
import { profileSessionGuard } from "@/lib/profile-session-guard";
import { isoDay, useServerToday } from "@/lib/server-clock";
import { formatMinutes } from "@/lib/time-minutes";
import { toast } from "@/lib/toast";
import { parseHoursPerWeek, useAvailableHours } from "./cost-queries";
import { DateField } from "./date-field";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

type HistoryIdentity = { userId: string; sessionId: string; host: string };

async function assertHistorySession(
  userId: string,
  sessionId: string,
  host: string,
) {
  if (window.location.host !== host) throw new HttpError(403, "Host changed");
  try {
    await profileSessionGuard(userId, sessionId)();
  } catch {
    throw new HttpError(403, "Session unavailable");
  }
  if (window.location.host !== host) throw new HttpError(403, "Host changed");
}

function TimeSettingsHistory({
  workspaceId,
  projectId,
  identity,
}: {
  workspaceId: string;
  projectId?: string;
  identity: HistoryIdentity;
}) {
  const queryClient = useQueryClient();
  const admission = useQuery({
    queryKey: [
      "time-settings-history-admission",
      identity.host,
      identity.userId,
      identity.sessionId,
      workspaceId,
      projectId ?? "",
    ],
    queryFn: async ({ signal }) => {
      const { userId, sessionId, host } = identity;
      const historyKey = settingsHistoryQueryKey(
        projectId ? "project" : "workspace",
        projectId ?? workspaceId,
        userId,
        sessionId,
      );
      try {
        await assertHistorySession(userId, sessionId, host);
        const [source, history] = await Promise.all([
          getTimeSettings(workspaceId, projectId),
          getSettingsHistory(
            projectId ? "project" : "workspace",
            projectId ?? workspaceId,
            signal,
          ),
        ]);
        await assertHistorySession(userId, sessionId, host);
        if (projectId && source.project?.id !== projectId) {
          if (!signal.aborted) queryClient.setQueryData(historyKey, null);
          return false;
        }
        if (!signal.aborted) queryClient.setQueryData(historyKey, history);
        return true;
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof HttpError &&
          [401, 403, 404].includes(error.status)
        )
          queryClient.setQueryData(historyKey, null);
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  if (admission.isError) {
    if (
      admission.error instanceof HttpError &&
      [401, 403, 404].includes(admission.error.status)
    )
      return null;
    return (
      <HistoryPresentation
        loading={false}
        error
        retry={() => void admission.refetch()}
        onOpen={() => {}}
      >
        {null}
      </HistoryPresentation>
    );
  }
  if (admission.isFetching || !admission.data) return null;
  return (
    <SettingsHistory
      type={projectId ? "project" : "workspace"}
      id={projectId ?? workspaceId}
      userId={identity.userId}
    />
  );
}

/** TC-4: how many days back people may log time without `time_entry:log_backdated`. */
export function BackdateLimitSetting() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const client = useQueryClient();
  const host = window.location.host;
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  const sessionScope = session?.session as
    | { portal?: string | null; impersonatedBy?: string | null }
    | undefined;
  const identity =
    userId &&
    sessionId &&
    !sessionScope?.impersonatedBy &&
    (!sessionScope?.portal || sessionScope.portal === "agent")
      ? { userId, sessionId, host }
      : null;
  const settings = useTimeSettings(workspace?.id);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [draft, setDraft] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const revision = useRef(0);
  const value = draft ?? String(settings.data?.backdateLimitDays ?? "");
  const days = /^\d{1,4}$/u.test(value) ? Number(value) : null;
  const valid = days !== null && days <= 3650;
  const lifecycle = useIntentLifecycle(
    JSON.stringify([
      host,
      userId,
      sessionId,
      sessionScope?.portal,
      sessionScope?.impersonatedBy,
      workspace?.id,
    ]),
    () => {
      revision.current += 1;
      setDraft(null);
      setSavedRevision(null);
      save.reset();
    },
  );
  const save = useMutation({
    mutationFn: ({
      workspaceId,
      days,
    }: {
      workspaceId: string;
      days: number;
      identity: HistoryIdentity | null;
      intent: number;
      revision: number;
    }) => updateTimeSettings({ workspaceId, backdateLimitDays: days }),
    onSuccess: async (
      result,
      { workspaceId, identity, intent, revision: saved },
    ) => {
      if (identity) {
        const { userId, sessionId, host } = identity;
        refreshSettingsHistory(
          client,
          settingsHistoryQueryKey("workspace", workspaceId, userId, sessionId),
          () => assertHistorySession(userId, sessionId, host),
        );
      }
      if (!lifecycle.isCurrent(intent) || !identity) return;
      try {
        await assertHistorySession(
          identity.userId,
          identity.sessionId,
          identity.host,
        );
        if (!lifecycle.isCurrent(intent)) return;
        const settingsKey = [
          "time-tracking",
          "settings",
          workspaceId,
          "",
        ] as const;
        await client.cancelQueries({ queryKey: settingsKey, exact: true });
        await assertHistorySession(
          identity.userId,
          identity.sessionId,
          identity.host,
        );
        if (!lifecycle.isCurrent(intent)) return;
        client.setQueryData(settingsKey, result);
      } catch {
        return;
      }
      if (revision.current === saved) {
        setDraft(null);
        setSavedRevision(saved);
        toast.success(t("timeTracking:settings.saved"));
      }
      await invalidate();
    },
    onError: (error, { intent }) => {
      if (lifecycle.isCurrent(intent)) toast.error(message(error));
    },
  });
  if (!settings.data) return null;
  const dirty = draft !== null && days !== settings.data.backdateLimitDays;
  const canEdit = settings.data.canManage && !sessionScope?.impersonatedBy;
  return (
    <>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            canEdit &&
            dirty &&
            valid &&
            !save.isPending &&
            workspace?.id &&
            days !== null
          )
            save.mutate({
              workspaceId: workspace.id,
              days,
              identity,
              intent: lifecycle.capture(),
              revision: revision.current,
            });
        }}
      >
        <div className="w-56 space-y-1">
          {canEdit ? (
            <>
              <Label htmlFor="backdate-limit" className="text-xs">
                {t("timeTracking:settings.backdateLimit")}
              </Label>
              <Input
                id="backdate-limit"
                inputMode="numeric"
                value={value}
                aria-invalid={!valid}
                disabled={save.isPending}
                onChange={(event) => {
                  revision.current += 1;
                  setSavedRevision(null);
                  setDraft(event.target.value);
                  if (!save.isPending) save.reset();
                }}
              />
            </>
          ) : (
            <p>
              {t("timeTracking:settings.backdateLimit")}:{" "}
              {settings.data.backdateLimitDays}
            </p>
          )}
        </div>
        {canEdit ? (
          <SaveButton
            type="submit"
            disabled={(!dirty || !valid) && !save.isPending}
            pending={save.isPending}
            success={save.isSuccess && savedRevision === revision.current}
            savedLabel={t("common:actions.saved")}
            workingLabel={t("common:actions.saving")}
            announceSuccess={false}
          >
            {t("timeTracking:actions.save")}
          </SaveButton>
        ) : null}
        <p className="basis-full text-muted-foreground text-xs">
          {t("timeTracking:settings.backdateHelp")}
        </p>
      </form>
      {workspace?.id && identity && !settings.isError ? (
        <TimeSettingsHistory
          key={JSON.stringify([host, userId, sessionId, workspace.id])}
          workspaceId={workspace.id}
          identity={identity}
        />
      ) : null}
    </>
  );
}

/** TC-3: the billable default for time logged on one project. */
export function ProjectBillableSetting({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const client = useQueryClient();
  const host = window.location.host;
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  const sessionScope = session?.session as
    | { portal?: string | null; impersonatedBy?: string | null }
    | undefined;
  const identity =
    userId &&
    sessionId &&
    !sessionScope?.impersonatedBy &&
    (!sessionScope?.portal || sessionScope.portal === "agent")
      ? { userId, sessionId, host }
      : null;
  const settings = useTimeSettings(workspace?.id, projectId);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const lifecycle = useIntentLifecycle(
    JSON.stringify([
      host,
      userId,
      sessionId,
      sessionScope?.portal,
      sessionScope?.impersonatedBy,
      workspace?.id,
      projectId,
    ]),
    () => save.reset(),
  );
  const save = useMutation({
    mutationFn: ({
      workspaceId,
      targetProjectId,
      defaultBillable,
    }: {
      workspaceId: string;
      targetProjectId: string;
      defaultBillable: boolean;
      identity: HistoryIdentity | null;
      intent: number;
    }) =>
      updateTimeSettings({
        workspaceId,
        project: { id: targetProjectId, defaultBillable },
      }),
    onSuccess: async (_result, { targetProjectId, identity, intent }) => {
      if (identity) {
        const { userId, sessionId, host } = identity;
        refreshSettingsHistory(
          client,
          settingsHistoryQueryKey(
            "project",
            targetProjectId,
            userId,
            sessionId,
          ),
          () => assertHistorySession(userId, sessionId, host),
        );
      }
      if (!lifecycle.isCurrent(intent)) return;
      toast.success(t("timeTracking:settings.saved"));
      await invalidate();
    },
    onError: (error, { intent }) => {
      if (lifecycle.isCurrent(intent)) toast.error(message(error));
    },
  });
  const project = settings.data?.project;
  if (!settings.data || !project) return null;
  const canEdit = settings.data.canManage && !sessionScope?.impersonatedBy;
  return (
    <>
      <div className="flex items-center gap-3">
        {canEdit ? (
          <Switch
            id="project-default-billable"
            checked={project.defaultBillable}
            disabled={save.isPending}
            onCheckedChange={(next) => {
              if (canEdit && workspace?.id)
                save.mutate({
                  workspaceId: workspace.id,
                  targetProjectId: projectId,
                  defaultBillable: next,
                  identity,
                  intent: lifecycle.capture(),
                });
            }}
          />
        ) : (
          <span>
            {t(
              project.defaultBillable
                ? "featureFlags:stateOn"
                : "featureFlags:stateOff",
            )}
          </span>
        )}
        <div className="space-y-0.5">
          {canEdit ? (
            <Label htmlFor="project-default-billable">
              {t("timeTracking:settings.defaultBillable")}
            </Label>
          ) : (
            <p>{t("timeTracking:settings.defaultBillable")}</p>
          )}
          <p className="text-muted-foreground text-xs">
            {t("timeTracking:settings.defaultBillableHelp")}
          </p>
        </div>
      </div>
      {workspace?.id &&
      identity &&
      !settings.isError &&
      project.id === projectId ? (
        <TimeSettingsHistory
          key={JSON.stringify([
            host,
            userId,
            sessionId,
            workspace.id,
            projectId,
          ])}
          workspaceId={workspace.id}
          projectId={projectId}
          identity={identity}
        />
      ) : null}
    </>
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
  const { data: session } = authClient.useSession();
  const impersonating = Boolean(
    (session?.session as { impersonatedBy?: string | null } | undefined)
      ?.impersonatedBy,
  );
  const settings = useTimeSettings(workspace?.id);
  const allowed = settings.data?.canManage === true;
  const hours = useAvailableHours(workspace?.id, allowed);
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [personPick, setPersonPick] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  // The default start day is the server's, never the browser clock's: the workspace's date
  // from the timesheet's `needsReview` probe, or the server clock while that is unavailable.
  const serverToday = isoDay(useServerToday());
  const today =
    useTimeEntries(
      workspace?.id && allowed
        ? { workspaceId: workspace.id, needsReview: true }
        : null,
    ).data?.today ?? serverToday;
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
  const canSubmit =
    personId !== null && minutes !== null && Boolean(effectiveFrom || today);
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
      {!impersonating ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!impersonating && canSubmit && !add.isPending) add.mutate();
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
          <SaveButton
            type="submit"
            disabled={!canSubmit && !add.isPending}
            pending={add.isPending}
            success={add.isSuccess}
            savedLabel={t("common:actions.saved")}
            workingLabel={t("common:actions.saving")}
            announceSuccess={false}
          >
            <Plus aria-hidden="true" />
            {t("timeTracking:availableHours.add")}
          </SaveButton>
        </form>
      ) : null}
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

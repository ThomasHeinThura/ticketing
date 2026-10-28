import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { addDays, addMonths, endOfMonth, startOfMonth } from "date-fns";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CalendarTask } from "@/components/calendar/calendar-task-bar";
import CalendarToolbar from "@/components/calendar/calendar-toolbar";
import MonthGrid from "@/components/calendar/month-grid";
import { buildMonthWeeks } from "@/components/calendar/month-grid-model";
import PageTitle from "@/components/page-title";
import {
  type CalendarChange,
  type Freeze,
  updateFreeze,
} from "@/fetchers/service-management";
import {
  useCatalogueStatus,
  useChangeCalendar,
  useFreezeOverrides,
  useFreezes,
  useInvalidateServiceManagement,
} from "@/hooks/queries/service-management";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { formatDateTime } from "@/lib/format";
import { getDefaultAgentTerm } from "@/lib/i18n/agent-translation";
import {
  dateFromCalendarMonth,
  formatCalendarMonth,
} from "@/lib/project-calendar-state";
import { type ChangeCalendarSearch, routes } from "@/lib/routes";
import { useServerToday } from "@/lib/server-clock";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { FreezeDialog } from "./freeze-dialog";
import {
  LoadingRows,
  MutationError,
  PageFrame,
  QueryFailure,
  RiskBadge,
  SectionNav,
} from "./shared";

const TABS = ["calendar", "freezes", "overrides"] as const;
const MAX_LANES = 4;

export function taskStatus(change: CalendarChange): string {
  if (change.frozen) return "frozen";
  if (change.conflict) return "conflict";
  if (change.retrospective) return "done";
  return "in-progress";
}

/** Bars for the Kaneo month grid: one per change window, one per freeze. */
export function buildTasks(
  changes: CalendarChange[],
  freezes: { id: string; name: string; startsAt: string; endsAt: string }[],
): CalendarTask[] {
  // The grid is day-granular and `scheduleEnd` is inclusive: a window ending exactly at
  // midnight does not spill onto the following day.
  const span = (start: string, end: string) => ({
    scheduleStart: new Date(start),
    scheduleEnd: new Date(
      Math.max(new Date(end).getTime() - 1, new Date(start).getTime()),
    ),
  });
  return [
    ...freezes.map((freeze) => ({
      id: `freeze:${freeze.id}`,
      title: freeze.name,
      number: null,
      status: "freeze",
      ...span(freeze.startsAt, freeze.endsAt),
    })),
    ...changes.map((change) => ({
      id: change.key,
      title: `${change.key} ${change.title}`,
      number: null,
      status: taskStatus(change),
      ...span(change.windowStart, change.windowEnd),
    })),
  ];
}

function CalendarTab({
  workspaceId,
  month,
  canManage,
  onEditFreeze,
}: {
  workspaceId: string;
  month?: string;
  canManage: boolean;
  onEditFreeze: (id: string) => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const navigate = useNavigate();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  // "Today" and the default month follow the server's clock, not the browser's.
  const today = useServerToday();
  const visibleMonth = useMemo(
    () => dateFromCalendarMonth(month ?? "", startOfMonth(today)),
    [month, today],
  );
  const weeks = useMemo(
    () => buildMonthWeeks(visibleMonth, weekStartsOn),
    [visibleMonth, weekStartsOn],
  );
  const from = weeks[0]?.[0] ?? startOfMonth(visibleMonth);
  const last = weeks.at(-1)?.at(-1) ?? endOfMonth(visibleMonth);
  const calendar = useChangeCalendar(workspaceId, from, addDays(last, 1));
  const tasks = useMemo(
    () =>
      calendar.data
        ? buildTasks(calendar.data.changes, calendar.data.freezes)
        : [],
    [calendar.data],
  );
  const go = (next: Date) =>
    void navigate({
      to: routes.serviceManagementChanges.path,
      search: {
        month: formatCalendarMonth(next),
      } satisfies ChangeCalendarSearch,
    });
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex min-h-[32rem] flex-col overflow-hidden rounded-md border">
        <CalendarToolbar
          visibleMonth={visibleMonth}
          onPreviousMonth={() => go(addMonths(visibleMonth, -1))}
          onNextMonth={() => go(addMonths(visibleMonth, 1))}
          onToday={() =>
            void navigate({ to: routes.serviceManagementChanges.path })
          }
        />
        {calendar.isError ? (
          <div className="p-4">
            <QueryFailure
              error={calendar.error}
              onRetry={() => void calendar.refetch()}
            />
          </div>
        ) : (
          <MonthGrid
            weeks={weeks}
            tasks={tasks}
            visibleMonth={visibleMonth}
            today={today}
            label={t("calendar.gridLabel")}
            maxLanes={MAX_LANES}
            onOpenTask={(id) => {
              if (id.startsWith("freeze:")) {
                if (canManage) onEditFreeze(id.slice("freeze:".length));
                return;
              }
              void navigate({
                to: routes.workItemDetail.path,
                params: { key: id },
              });
            }}
          />
        )}
      </div>
      <ul
        className="flex flex-wrap gap-3 text-xs text-muted-foreground"
        aria-label={t("calendar.legend.title")}
      >
        {(["change", "conflict", "frozen", "freeze", "past"] as const).map(
          (kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <Badge
                variant={
                  kind === "frozen"
                    ? "destructive"
                    : kind === "conflict"
                      ? "warning"
                      : kind === "past"
                        ? "success"
                        : "outline"
                }
              >
                {t(`calendar.legend.${kind}`)}
              </Badge>
            </li>
          ),
        )}
      </ul>
      {calendar.data && calendar.data.conflicts.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>{t("calendar.conflicts.title")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ps-5">
              {calendar.data.conflicts.map((conflict) => (
                <li key={conflict.changeKeys.join("+")}>
                  {t("calendar.conflicts.item", {
                    first: conflict.changeKeys[0],
                    second: conflict.changeKeys[1],
                    services: conflict.serviceIds.length,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {calendar.isLoading ? <LoadingRows /> : null}
      {calendar.data && calendar.data.changes.length > 0 ? (
        <Table aria-label={t("calendar.table.label")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("calendar.table.change")}</TableHead>
              <TableHead>{t("calendar.table.window")}</TableHead>
              <TableHead>{t("calendar.table.services")}</TableHead>
              <TableHead>{t("calendar.table.risk")}</TableHead>
              <TableHead>{t("calendar.table.flags")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calendar.data.changes.map((change) => (
              <TableRow key={change.key}>
                <TableCell>
                  <Link
                    className="underline-offset-4 hover:underline"
                    to={routes.workItemDetail.path}
                    params={{ key: change.key }}
                  >
                    {change.key}
                  </Link>{" "}
                  {change.title}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(change.windowStart)} –{" "}
                  {formatDateTime(change.windowEnd)}
                </TableCell>
                <TableCell>
                  {change.services.map((service) => service.name).join(", ") ||
                    t("calendar.table.noServices")}
                </TableCell>
                <TableCell>
                  <RiskBadge risk={change.risk} />
                </TableCell>
                <TableCell className="space-x-1">
                  {change.frozen ? (
                    <Badge variant="destructive">
                      {t("calendar.flags.frozen")}
                    </Badge>
                  ) : null}
                  {change.overridden ? (
                    <Badge variant="warning">
                      {t("calendar.flags.overridden")}
                    </Badge>
                  ) : null}
                  {change.conflict ? (
                    <Badge variant="warning">
                      {t("calendar.flags.conflict")}
                    </Badge>
                  ) : null}
                  {change.retrospective ? (
                    <Badge variant="secondary">
                      {t("calendar.flags.past")}
                    </Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : calendar.data ? (
        <p className="text-sm text-muted-foreground">{t("calendar.empty")}</p>
      ) : null}
    </div>
  );
}

function FreezesTab({
  workspaceId,
  canManage,
  editing,
  onEdit,
}: {
  workspaceId: string;
  canManage: boolean;
  editing: string | "new" | null;
  onEdit: (id: string | "new" | null) => void;
}) {
  const { t } = useTranslation("serviceManagement");
  const invalidate = useInvalidateServiceManagement();
  const [showCancelled, setShowCancelled] = useState(false);
  const freezes = useFreezes(workspaceId, showCancelled);
  const cancel = useMutation({
    mutationFn: (freeze: Freeze) =>
      updateFreeze(freeze.id, { cancel: true, version: freeze.version }),
    onSuccess: () => invalidate(),
  });
  const editingFreeze =
    editing && editing !== "new"
      ? freezes.data?.find((freeze) => freeze.id === editing)
      : undefined;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Switch
            id="show-cancelled-freezes"
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
          />
          <Label htmlFor="show-cancelled-freezes">
            {t("freezes.showCancelled")}
          </Label>
        </div>
        {canManage ? (
          <Button onClick={() => onEdit("new")}>
            <Plus aria-hidden="true" />
            {t("freezes.new")}
          </Button>
        ) : null}
      </div>
      {freezes.isLoading ? <LoadingRows /> : null}
      {freezes.isError ? (
        <QueryFailure
          error={freezes.error}
          onRetry={() => void freezes.refetch()}
        />
      ) : null}
      {freezes.data && freezes.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("freezes.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("freezes.emptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {freezes.data && freezes.data.length > 0 ? (
        <CardFrame>
          {freezes.data.map((freeze) => (
            <Card key={freeze.id}>
              <CardHeader>
                <CardTitle>{freeze.name}</CardTitle>
                <CardDescription>
                  {formatDateTime(freeze.startsAt)} –{" "}
                  {formatDateTime(freeze.endsAt)}
                  {freeze.reason ? ` · ${freeze.reason}` : ""}
                </CardDescription>
                <CardAction className="flex items-center gap-2">
                  {freeze.cancelledAt ? (
                    <Badge variant="secondary">{t("freezes.cancelled")}</Badge>
                  ) : canManage ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onEdit(freeze.id)}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(freeze)}
                      >
                        {t("freezes.cancel")}
                      </Button>
                    </>
                  ) : null}
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </CardFrame>
      ) : null}
      <MutationError error={cancel.error} />
      {editing === "new" ? (
        <FreezeDialog workspaceId={workspaceId} onClose={() => onEdit(null)} />
      ) : editingFreeze ? (
        <FreezeDialog
          workspaceId={workspaceId}
          freeze={editingFreeze}
          onClose={() => onEdit(null)}
        />
      ) : null}
    </div>
  );
}

/** The prominent audit report of freeze overrides (CH-4). */
function OverridesTab({
  workspaceId,
  enabled,
}: {
  workspaceId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation("serviceManagement");
  const overrides = useFreezeOverrides(workspaceId, enabled);
  if (!enabled)
    return (
      <p className="text-sm text-muted-foreground">{t("overrides.denied")}</p>
    );
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        {t("overrides.description")}
      </p>
      {overrides.isLoading ? <LoadingRows /> : null}
      {overrides.isError ? (
        <QueryFailure
          error={overrides.error}
          onRetry={() => void overrides.refetch()}
        />
      ) : null}
      {overrides.data && overrides.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("overrides.empty")}</p>
      ) : null}
      {overrides.data && overrides.data.length > 0 ? (
        <Table aria-label={t("overrides.title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("overrides.when")}</TableHead>
              <TableHead>{t("overrides.who")}</TableHead>
              <TableHead>{t("overrides.change")}</TableHead>
              <TableHead>{t("overrides.freezes")}</TableHead>
              <TableHead>{t("overrides.reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(row.at)}
                </TableCell>
                <TableCell>{row.actorName ?? t("overrides.unknown")}</TableCell>
                <TableCell>
                  {row.workItemKey ? (
                    <Link
                      className="underline-offset-4 hover:underline"
                      to={routes.workItemDetail.path}
                      params={{ key: row.workItemKey }}
                    >
                      {row.workItemKey}
                    </Link>
                  ) : null}
                </TableCell>
                <TableCell>{row.freezeNames.join(", ")}</TableCell>
                <TableCell>{row.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}

/**
 * `docs/screens.md` "Change calendar" (`CH-4`, `CH-5`): planned windows, freezes and
 * same-service conflicts on the Kaneo month grid; freeze management; the override report.
 */
export function ChangeCalendarView({
  search,
}: {
  search: ChangeCalendarSearch;
}) {
  const { t, i18n } = useTranslation("serviceManagement");
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const status = useCatalogueStatus(workspaceId);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const tab = search.tab ?? "calendar";
  const canManage = status.data?.canManageChanges === true;
  return (
    <>
      <PageTitle title={t("changes.title")} />
      <PageFrame
        title={
          <span title={getDefaultAgentTerm(i18n, "change", 2)}>
            {t("changes.title")}
          </span>
        }
        description={t("changes.description")}
      >
        <SectionNav active="changes" />
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label={t("changes.tabs")}
        >
          {TABS.filter((entry) => entry !== "overrides" || canManage).map(
            (entry) => (
              <Button
                key={entry}
                role="tab"
                aria-selected={tab === entry}
                size="sm"
                variant={tab === entry ? "secondary" : "ghost"}
                onClick={() =>
                  void navigate({
                    to: routes.serviceManagementChanges.path,
                    search: {
                      ...(search.month ? { month: search.month } : {}),
                      ...(entry === "calendar" ? {} : { tab: entry }),
                    },
                  })
                }
              >
                {t(`changes.tab.${entry}`)}
              </Button>
            ),
          )}
        </div>
        {!workspace ? (
          <LoadingRows />
        ) : tab === "calendar" ? (
          <CalendarTab
            workspaceId={workspace.id}
            month={search.month}
            canManage={canManage}
            onEditFreeze={(id) => {
              void navigate({
                to: routes.serviceManagementChanges.path,
                search: { tab: "freezes" },
              });
              setEditing(id);
            }}
          />
        ) : tab === "freezes" ? (
          <FreezesTab
            workspaceId={workspace.id}
            canManage={canManage}
            editing={editing}
            onEdit={setEditing}
          />
        ) : (
          <OverridesTab workspaceId={workspace.id} enabled={canManage} />
        )}
      </PageFrame>
    </>
  );
}

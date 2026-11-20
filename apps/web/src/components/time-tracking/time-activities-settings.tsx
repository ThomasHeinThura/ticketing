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
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  LoadingStatus,
  SAVE_FEEDBACK_HOLD_MS,
  SaveButton,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useDelayedPending,
} from "@taskdesk/ui";

import { History, Plus } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import {
  isForbiddenError,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
import {
  createTimeActivity,
  type TimeActivity,
  TimeTrackingDisabledError,
  updateTimeActivity,
} from "@/fetchers/time-tracking";
import type { HistoryTarget } from "@/hooks/queries/settings/use-settings-history";
import { useTimeActivities } from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { AvailableHoursSetting, BackdateLimitSetting } from "./time-settings";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

const SettingsHistory = lazy(() =>
  import("@/components/settings/settings-history").then((m) => ({
    default: m.SettingsHistory,
  })),
);

const activityTarget = (workspaceId: string, id: string): HistoryTarget[] => [
  {
    kind: "entity",
    type: "time_activity",
    id,
    scope: { kind: "workspace", workspaceId },
  },
];

function ActivityRow({
  activity,
  workspaceId,
  canManage,
  onHistory,
}: {
  activity: TimeActivity;
  workspaceId: string;
  canManage: boolean;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [name, setName] = useState(activity.name);
  const [nameSaved, setNameSaved] = useState(false);
  const previousName = useRef(activity.name);
  useEffect(() => {
    if (previousName.current !== activity.name) {
      previousName.current = activity.name;
      setName(activity.name);
    }
  }, [activity.name]);
  useEffect(() => {
    if (!nameSaved) return;
    const timer = setTimeout(() => setNameSaved(false), SAVE_FEEDBACK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [nameSaved]);
  // The row and workspace are captured when the write starts, so a later change of either
  // cannot redirect the History withdrawal.
  const save = useMutation({
    mutationFn: (changes: {
      id: string;
      workspaceId: string;
      name?: string;
      archived?: boolean;
    }) =>
      updateTimeActivity(changes.id, changes.workspaceId, {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.archived === undefined
          ? {}
          : { archived: changes.archived }),
      }),
    meta: {
      audits: {
        targets: (changes: { id: string; workspaceId: string }) =>
          activityTarget(changes.workspaceId, changes.id),
      },
    },
    onMutate: () => setNameSaved(false),
    onSuccess: async (_result, changes) => {
      await invalidate();
      if (changes.name !== undefined) setNameSaved(true);
    },
    onError: (error) => {
      setName(activity.name);
      toast.error(message(error));
    },
  });
  const dirty = name.trim() !== activity.name && name.trim() !== "";
  const captured = { id: activity.id, workspaceId };
  return (
    <TableRow data-testid="time-activity-row">
      <TableCell>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Input
              aria-label={t("timeTracking:activities.nameLabel", {
                name: activity.name,
              })}
              maxLength={80}
              value={name}
              disabled={save.isPending}
              onChange={(event) => {
                setNameSaved(false);
                setName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  dirty &&
                  !save.isPending &&
                  canManage
                )
                  save.mutate({ ...captured, name: name.trim() });
              }}
            />
          ) : (
            <span>{activity.name}</span>
          )}
          {canManage &&
          (dirty ||
            nameSaved ||
            (save.isPending && save.variables?.name !== undefined)) ? (
            <SaveButton
              size="sm"
              pending={save.isPending && save.variables?.name !== undefined}
              success={nameSaved}
              savedLabel={t("common:actions.saved")}
              workingLabel={t("common:actions.saving")}
              disabled={
                !canManage ||
                (save.isPending && save.variables?.name === undefined)
              }
              onClick={() => {
                if (!save.isPending && dirty)
                  save.mutate({ ...captured, name: name.trim() });
              }}
            >
              {t("timeTracking:actions.save")}
            </SaveButton>
          ) : null}
          {activity.archived ? (
            <Badge variant="outline">
              {t("timeTracking:activities.archived")}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="w-40">
        <div className="flex items-center gap-2">
          {canManage ? (
            <>
              <Switch
                id={`activity-active-${activity.id}`}
                checked={!activity.archived}
                disabled={save.isPending}
                onCheckedChange={(active) =>
                  save.mutate({ ...captured, archived: !active })
                }
              />
              <Label
                htmlFor={`activity-active-${activity.id}`}
                className="text-xs"
              >
                {t("timeTracking:activities.active")}
              </Label>
            </>
          ) : (
            <span>
              {t(
                activity.archived
                  ? "timeTracking:activities.archived"
                  : "timeTracking:activities.active",
              )}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="w-32">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label={`${t("settings:history.title", { defaultValue: "History" })}: ${activity.name}`}
          onClick={onHistory}
        >
          <History className="size-4" />
          {t("settings:history.title", { defaultValue: "History" })}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** `docs/screens.md` "Workspace — time activities" (P5, `TC-2`): the types a time entry must carry. */
function TimeActivitiesSettingsContent() {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageWorkspaceSettings() && !isCheckingPermissions;
  const activities = useTimeActivities(workspace?.id, true);
  const [name, setName] = useState("");
  // The History being read, pinned to the row and workspace it was opened for.
  const [history, setHistory] = useState<{
    activityId: string;
    workspaceId: string;
  } | null>(null);
  const add = useMutation({
    mutationFn: (captured: { workspaceId: string; name: string }) =>
      createTimeActivity({
        workspaceId: captured.workspaceId,
        name: captured.name,
      }),
    // The new row's identity is the persisted one from the response.
    meta: {
      audits: {
        targets: (
          captured: { workspaceId: string },
          created: { id?: unknown } | undefined,
        ) =>
          typeof created?.id === "string"
            ? activityTarget(captured.workspaceId, created.id)
            : [],
      },
    },
    onSuccess: async () => {
      setName("");
      await invalidate();
    },
    onError: (error) => toast.error(message(error)),
  });
  const loading = workspaceLoading || activities.isLoading;
  const placeholderVisible = useDelayedPending(loading, {
    releaseNow:
      !loading && activities.isSuccess && activities.data.length === 0,
  });
  // Open only while the row is still listed for the same workspace.
  const openHistory =
    history && history.workspaceId === workspace?.id
      ? activities.data?.find((activity) => activity.id === history.activityId)
      : undefined;
  // Once the pinned workspace or listed row stops matching, the selection is
  // dropped for good so a later round trip cannot reopen it.
  const selectionStale = history !== null && !openHistory;
  useEffect(() => {
    if (selectionStale) setHistory(null);
  }, [selectionStale]);
  const disabled = activities.error instanceof TimeTrackingDisabledError;
  if (isForbiddenError(activities.error)) return <NoAccessPage />;
  return (
    <TimeActivitiesSettingsFrame>
      {!activities.isError &&
      (loading || (placeholderVisible && activities.data)) ? (
        <LoadingStatus
          visible={placeholderVisible}
          label={t("common:empty.loading")}
        >
          <Skeleton
            className="h-32 w-full"
            role="status"
            style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
          />
        </LoadingStatus>
      ) : disabled ? (
        <Alert variant="info">
          <AlertTitle>{t("timeTracking:timesheet.disabledTitle")}</AlertTitle>
          <AlertDescription>
            {t("timeTracking:timesheet.disabledDescription")}
          </AlertDescription>
        </Alert>
      ) : activities.isError || !activities.data ? (
        <Alert variant="error">
          <AlertTitle>{t("timeTracking:activities.loadError")}</AlertTitle>
        </Alert>
      ) : (
        <>
          <BackdateLimitSetting />
          <AvailableHoursSetting />
          {canManage ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() && !add.isPending)
                  add.mutate({
                    workspaceId: workspace?.id as string,
                    name: name.trim(),
                  });
              }}
            >
              <div className="w-64 space-y-1">
                <Label htmlFor="activity-new" className="text-xs">
                  {t("timeTracking:activities.newLabel")}
                </Label>
                <Input
                  id="activity-new"
                  maxLength={80}
                  value={name}
                  disabled={add.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <SaveButton
                type="submit"
                disabled={!name.trim() && !add.isPending && !add.isSuccess}
                pending={add.isPending}
                success={add.isSuccess}
                savedLabel={t("common:actions.saved")}
                workingLabel={t("common:actions.saving")}
              >
                <Plus aria-hidden="true" />
                {t("timeTracking:activities.add")}
              </SaveButton>
            </form>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("timeTracking:fields.activity")}</TableHead>
                <TableHead className="w-40">
                  {t("timeTracking:activities.status")}
                </TableHead>
                <TableHead className="w-32">
                  {t("settings:history.title", { defaultValue: "History" })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.data.map((activity) => (
                <ActivityRow
                  key={activity.id}
                  activity={activity}
                  workspaceId={workspace?.id ?? ""}
                  canManage={canManage}
                  onHistory={() =>
                    workspace?.id &&
                    setHistory({
                      activityId: activity.id,
                      workspaceId: workspace.id,
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
          {openHistory ? (
            <Dialog open onOpenChange={(open) => !open && setHistory(null)}>
              <DialogContent closeLabel={t("common:actions.close")}>
                <DialogHeader>
                  <DialogTitle>
                    {t("settings:history.title", { defaultValue: "History" })}
                  </DialogTitle>
                  <DialogDescription>{openHistory.name}</DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <Suspense fallback={null}>
                    <SettingsHistory
                      key={`${openHistory.id}:${history?.workspaceId}`}
                      target={{
                        kind: "entity",
                        type: "time_activity",
                        id: openHistory.id,
                        scope: {
                          kind: "workspace",
                          workspaceId: history?.workspaceId as string,
                        },
                      }}
                    />
                  </Suspense>
                </DialogPanel>
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      )}
    </TimeActivitiesSettingsFrame>
  );
}

/**
 * `GET /api/time-activities` needs `time_entry:create`: a role without it (reached by URL only)
 * sees one access notice and the screen never sends the requests the server would refuse.
 */
export function TimeActivitiesSettings() {
  const access = useSettingsAccess((permission) => permission.canLogTime());
  if (access === "allowed") return <TimeActivitiesSettingsContent />;
  return (
    <SettingsAccessPage
      access={access}
      titleKey="timeTracking:activities.title"
      descriptionKey="timeTracking:activities.description"
    />
  );
}

function TimeActivitiesSettingsFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PageTitle title={t("timeTracking:activities.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl">
            {t("timeTracking:activities.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm">
            {t("timeTracking:activities.description")}
          </p>
        </div>
        {children}
      </div>
    </>
  );
}

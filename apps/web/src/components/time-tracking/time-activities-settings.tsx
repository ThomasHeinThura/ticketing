import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Label,
  LoadingStatus,
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
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  isForbiddenError,
  SettingsAccessDenied,
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import {
  createTimeActivity,
  type TimeActivity,
  TimeTrackingDisabledError,
  updateTimeActivity,
} from "@/fetchers/time-tracking";
import { useTimeActivities } from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { AvailableHoursSetting, BackdateLimitSetting } from "./time-settings";
import { useInvalidateTime, useTimeErrorMessage } from "./time-shared";

function ActivityRow({
  activity,
  workspaceId,
  canManage,
}: {
  activity: TimeActivity;
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateTime();
  const message = useTimeErrorMessage();
  const [name, setName] = useState(activity.name);
  const save = useMutation({
    mutationFn: (changes: { name?: string; archived?: boolean }) =>
      updateTimeActivity(activity.id, workspaceId, changes),
    onSuccess: invalidate,
    onError: (error) => {
      setName(activity.name);
      toast.error(message(error));
    },
  });
  const dirty = name.trim() !== activity.name && name.trim() !== "";
  return (
    <TableRow data-testid="time-activity-row">
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            aria-label={t("timeTracking:activities.nameLabel", {
              name: activity.name,
            })}
            maxLength={80}
            value={name}
            disabled={!canManage || save.isPending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty)
                save.mutate({ name: name.trim() });
            }}
          />
          {dirty ? (
            <Button
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate({ name: name.trim() })}
            >
              {t("timeTracking:actions.save")}
            </Button>
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
          <Switch
            id={`activity-active-${activity.id}`}
            checked={!activity.archived}
            disabled={!canManage || save.isPending}
            onCheckedChange={(active) => save.mutate({ archived: !active })}
          />
          <Label htmlFor={`activity-active-${activity.id}`} className="text-xs">
            {t("timeTracking:activities.active")}
          </Label>
        </div>
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
  const add = useMutation({
    mutationFn: () =>
      createTimeActivity({
        workspaceId: workspace?.id as string,
        name: name.trim(),
      }),
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
  const disabled = activities.error instanceof TimeTrackingDisabledError;
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
      ) : isForbiddenError(activities.error) ? (
        <SettingsAccessDenied />
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
                if (name.trim() && !add.isPending) add.mutate();
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
              <Button type="submit" disabled={!name.trim() || add.isPending}>
                <Plus aria-hidden="true" />
                {t("timeTracking:activities.add")}
              </Button>
            </form>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("timeTracking:fields.activity")}</TableHead>
                <TableHead className="w-40">
                  {t("timeTracking:activities.status")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.data.map((activity) => (
                <ActivityRow
                  key={`${activity.id}:${activity.name}:${activity.archived}`}
                  activity={activity}
                  workspaceId={workspace?.id ?? ""}
                  canManage={canManage}
                />
              ))}
            </TableBody>
          </Table>
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
    <TimeActivitiesSettingsFrame>
      <SettingsAccessGate access={access}>{null}</SettingsAccessGate>
    </TimeActivitiesSettingsFrame>
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

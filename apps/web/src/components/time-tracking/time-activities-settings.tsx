import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Input,
  Label,
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
} from "@taskdesk/ui";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import {
  isForbiddenError,
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
  const save = useMutation({
    mutationFn: (changes: { name?: string; archived?: boolean }) =>
      updateTimeActivity(activity.id, workspaceId, changes),
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
                  save.mutate({ name: name.trim() });
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
                  save.mutate({ name: name.trim() });
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
                onCheckedChange={(active) => save.mutate({ archived: !active })}
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
  const disabled = activities.error instanceof TimeTrackingDisabledError;
  if (isForbiddenError(activities.error)) return <NoAccessPage />;
  return (
    <TimeActivitiesSettingsFrame>
      {loading ? (
        <Skeleton className="h-32 w-full" role="status" />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.data.map((activity) => (
                <ActivityRow
                  key={activity.id}
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
  return <SettingsAccessGate access={access}>{null}</SettingsAccessGate>;
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

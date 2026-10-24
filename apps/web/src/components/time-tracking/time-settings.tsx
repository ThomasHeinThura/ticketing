import { useMutation } from "@tanstack/react-query";
import { Button, Input, Label, Switch } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateTimeSettings } from "@/fetchers/time-tracking";
import { useTimeSettings } from "@/hooks/queries/time-tracking/use-time-tracking";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { toast } from "@/lib/toast";
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

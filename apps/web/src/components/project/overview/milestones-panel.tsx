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
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Skeleton,
} from "@taskdesk/ui";
import {
  CheckCircle2,
  Ellipsis,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/common/date-field";
import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  type Milestone,
  projectOverviewKeys,
  updateMilestone,
} from "@/fetchers/project/overview";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { toast } from "@/lib/toast";
import {
  formatDate,
  isPastDay,
  Panel,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

type MilestoneState = "reached" | "current" | "overdue" | "upcoming";

/** Reached; else current (the first not reached, by date) and/or overdue (due day passed). */
export function milestoneStates(
  milestones: readonly Pick<Milestone, "id" | "date" | "reachedAt">[],
  now = new Date(),
): Map<string, MilestoneState> {
  const states = new Map<string, MilestoneState>();
  const sorted = [...milestones].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const currentId = sorted.find((milestone) => !milestone.reachedAt)?.id;
  for (const milestone of sorted) {
    if (milestone.reachedAt) states.set(milestone.id, "reached");
    else if (isPastDay(String(milestone.date), now))
      states.set(milestone.id, "overdue");
    else if (milestone.id === currentId) states.set(milestone.id, "current");
    else states.set(milestone.id, "upcoming");
  }
  return states;
}

const STATE_VARIANT = {
  reached: "success",
  current: "info",
  overdue: "error",
  upcoming: "outline",
} as const;

/** The plan's milestones: list, add, edit, mark reached, delete (a pending action). */
export function MilestonesPanel({
  projectId,
  canUpdate,
}: {
  projectId: string;
  canUpdate: boolean;
}) {
  const { t, i18n } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const openPendingAction = useOpenPendingAction();
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const query = useQuery({
    queryKey: projectOverviewKeys.milestones(projectId),
    queryFn: () => listMilestones(projectId),
  });
  const toggle = useMutation({
    mutationFn: (milestone: Milestone) =>
      updateMilestone(projectId, milestone.id, {
        reached: !milestone.reachedAt,
      }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(failure(error)),
  });
  const remove = useMutation({
    mutationFn: (milestone: Milestone) =>
      deleteMilestone(projectId, milestone.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(failure(error)),
  });

  const milestones = query.data ?? [];
  const states = milestoneStates(milestones);

  return (
    <Panel
      title={t("milestones.title")}
      testId="project-milestones-panel"
      actions={
        canUpdate ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("milestones.add")}
          </Button>
        ) : null
      }
    >
      {query.isLoading ? (
        <div role="status" aria-label={t("loading")} className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : query.isError ? (
        <p className="text-destructive-foreground text-sm">
          {t("milestones.loadFailed")}
        </p>
      ) : milestones.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("milestones.empty")}</p>
      ) : (
        <ol className="flex flex-col divide-y">
          {[...milestones]
            .sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            )
            .map((milestone) => {
              const state = states.get(milestone.id) ?? "upcoming";
              return (
                <li
                  key={milestone.id}
                  className="flex items-center gap-3 py-2"
                  data-testid="project-milestone-row"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={
                        state === "reached"
                          ? "truncate text-muted-foreground line-through"
                          : "truncate"
                      }
                    >
                      {milestone.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(String(milestone.date), i18n.language)}
                    </span>
                  </div>
                  <Badge variant={STATE_VARIANT[state]}>
                    {t(`milestones.state.${state}`)}
                  </Badge>
                  {canUpdate ? (
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            aria-label={t("common.actionsFor", {
                              name: milestone.name,
                            })}
                          />
                        }
                      >
                        <Ellipsis className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => toggle.mutate(milestone)}>
                          {milestone.reachedAt ? (
                            <Undo2 className="size-4" />
                          ) : (
                            <CheckCircle2 className="size-4" />
                          )}
                          {milestone.reachedAt
                            ? t("milestones.markNotReached")
                            : t("milestones.markReached")}
                        </MenuItem>
                        <MenuItem onClick={() => setEditing(milestone)}>
                          <Pencil className="size-4" />
                          {t("common.edit")}
                        </MenuItem>
                        <MenuItem
                          variant="destructive"
                          onClick={() => remove.mutate(milestone)}
                        >
                          <Trash2 className="size-4" />
                          {t("common.delete")}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  ) : null}
                </li>
              );
            })}
        </ol>
      )}
      {editing ? (
        <MilestoneDialog
          projectId={projectId}
          milestone={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

function MilestoneDialog({
  projectId,
  milestone,
  onClose,
}: {
  projectId: string;
  milestone: Milestone | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [name, setName] = useState(milestone?.name ?? "");
  const [date, setDate] = useState(
    milestone ? String(milestone.date).slice(0, 10) : "",
  );
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), date: `${date}T00:00:00.000Z` };
      return milestone
        ? updateMilestone(projectId, milestone.id, body)
        : createMilestone(projectId, body);
    },
    onSuccess: async () => {
      await refresh();
      toast.success(t("milestones.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>
            {milestone ? t("milestones.editTitle") : t("milestones.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("milestones.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="milestone-name">{t("milestones.name")}</Label>
            <Input
              id="milestone-name"
              value={name}
              maxLength={200}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="milestone-date">{t("milestones.date")}</Label>
            <DateField
              id="milestone-date"
              placeholder={t("common.pickDate")}
              label={t("milestones.date")}
              value={date}
              onChange={setDate}
              disabled={save.isPending}
              dateEntry={{
                label: t("common:dateEntry", { label: t("milestones.date") }),
                invalidLabel: t("common:invalidDate"),
                saveLabel: t("common.save"),
              }}
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
            disabled={!name.trim() || !date || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

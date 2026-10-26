import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  createIntakeQueue,
  getIntakeQueue,
  listIntakeQueues,
  type QueueVisibility,
  updateIntakeQueue,
} from "@/fetchers/intake-queues";
import { getShareableViewTeams } from "@/fetchers/saved-views";
import { HttpError } from "@/lib/http-error";

const CURRENT_QUEUE = "__current__";

function mergeQuery(
  persisted: unknown,
  override: Record<string, unknown>,
  mergeSubmissionFilters = false,
): Record<string, unknown> {
  const base =
    persisted && typeof persisted === "object" && !Array.isArray(persisted)
      ? (persisted as Record<string, unknown>)
      : {};
  const merged = { ...base, ...override };
  if (mergeSubmissionFilters) {
    const baseFilter =
      base.filter &&
      typeof base.filter === "object" &&
      !Array.isArray(base.filter)
        ? (base.filter as Record<string, unknown>)
        : {};
    const overrideFilter =
      override.filter &&
      typeof override.filter === "object" &&
      !Array.isArray(override.filter)
        ? (override.filter as Record<string, unknown>)
        : {};
    if (base.filter !== undefined || override.filter !== undefined) {
      merged.filter = { ...baseFilter, ...overrideFilter };
    }
  }
  return merged;
}

export function IntakeQueuePicker({
  workspaceId,
  queueId,
  canCreate,
  canShare,
  currentSubmissionQuery,
  currentWorkItemQuery,
  onSelect,
}: {
  workspaceId: string;
  queueId?: string;
  canCreate: boolean;
  canShare: boolean;
  /** Defined only when the corresponding live URL query is explicitly overridden. */
  currentSubmissionQuery?: Record<string, unknown>;
  currentWorkItemQuery?: Record<string, unknown>;
  onSelect: (queueId?: string) => void;
}) {
  const { t } = useTranslation("intake");
  const { user } = useAuth();
  const cache = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<QueueVisibility>("private");
  const [teamId, setTeamId] = useState("");
  const queues = useQuery({
    queryKey: ["intake", "queues", workspaceId, user?.id],
    queryFn: () => listIntakeQueues(workspaceId),
    enabled: Boolean(workspaceId && user?.id),
  });
  const teams = useQuery({
    queryKey: ["intake", "queue-teams", workspaceId, user?.id],
    queryFn: () => getShareableViewTeams(workspaceId),
    enabled: Boolean(dialogOpen && visibility === "team" && canShare),
  });
  const queueDetail = useQuery({
    queryKey: ["intake", "queue", workspaceId, queueId, user?.id],
    queryFn: () => getIntakeQueue({ workspaceId, id: queueId ?? "" }),
    enabled: Boolean(dialogOpen && queueId),
  });
  useEffect(() => {
    if (!dialogOpen || !queueDetail.data) return;
    setName(queueDetail.data.name);
    setVisibility(queueDetail.data.visibility);
    setTeamId(queueDetail.data.sharedWithTeamId ?? "");
  }, [dialogOpen, queueDetail.data]);
  const save = useMutation({
    mutationFn: () => {
      if (queueId) {
        if (!queueDetail.data) throw new Error("Queue details are not loaded");
        const submissionQuery = currentSubmissionQuery
          ? mergeQuery(
              queueDetail.data.submissionView.query,
              currentSubmissionQuery,
              true,
            )
          : undefined;
        const workItemQuery = currentWorkItemQuery
          ? mergeQuery(
              queueDetail.data.workItemView.query,
              currentWorkItemQuery,
            )
          : undefined;
        return updateIntakeQueue({
          id: queueId,
          workspaceId,
          expectedVersions: queueDetail.data.versions,
          name: name.trim(),
          visibility,
          sharedWithTeamId: visibility === "team" ? teamId : null,
          ...(submissionQuery ? { submissionQuery } : {}),
          ...(workItemQuery ? { workItemQuery } : {}),
        });
      }
      return createIntakeQueue({
        workspaceId,
        name: name.trim(),
        visibility,
        ...(visibility === "team" ? { sharedWithTeamId: teamId } : {}),
        submissionQuery: currentSubmissionQuery ?? { entity: "submission" },
        workItemQuery: currentWorkItemQuery ?? { entity: "work_item" },
      });
    },
    onSuccess: async (queue) => {
      await cache.invalidateQueries({
        queryKey: ["intake", "queues", workspaceId, user?.id],
      });
      await cache.invalidateQueries({
        queryKey: ["intake", "queue", workspaceId, queue.id],
      });
      await cache.invalidateQueries({
        queryKey: ["intake", "queue-run", workspaceId, queue.id],
      });
      setDialogOpen(false);
      onSelect(queue.id);
    },
  });
  const selectable =
    queues.data?.some((queue) => queue.id === queueId) ?? false;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Select
        value={selectable ? queueId : CURRENT_QUEUE}
        onValueChange={(value) =>
          onSelect(value && value !== CURRENT_QUEUE ? value : undefined)
        }
      >
        <SelectTrigger
          className="w-full min-w-48 max-w-72"
          aria-label={t("queue.choose")}
        >
          <SelectValue placeholder={t("queue.choose")}>
            {selectable
              ? (queues.data?.find((queue) => queue.id === queueId)?.name ??
                t("queue.current"))
              : t("queue.current")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CURRENT_QUEUE}>{t("queue.current")}</SelectItem>
          {(queues.data ?? []).map((queue) => (
            <SelectItem key={queue.id} value={queue.id}>
              {queue.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {queues.isLoading && <span role="status">{t("queue.loading")}</span>}
      {canCreate && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!queueId) {
              setName("");
              setVisibility("private");
              setTeamId("");
            }
            setDialogOpen(true);
          }}
        >
          {queueId ? t("queue.edit") : t("queue.save")}
        </Button>
      )}
      {queues.isError && (
        <Alert variant="error" role="alert">
          <AlertDescription>{t("queue.loadFailed")}</AlertDescription>
        </Alert>
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => !save.isPending && setDialogOpen(open)}
      >
        <DialogContent closeLabel={t("common:actions.close")}>
          <DialogHeader>
            <DialogTitle>
              {queueId ? t("queue.editTitle") : t("queue.saveTitle")}
            </DialogTitle>
            <DialogDescription>{t("queue.saveDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="intake-queue-name">{t("queue.name")}</Label>
              <Input
                id="intake-queue-name"
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="intake-queue-visibility">
                {t("queue.visibility")}
              </Label>
              <Select
                value={visibility}
                onValueChange={(value) => {
                  if (value === "private" || (value === "team" && canShare)) {
                    setVisibility(value);
                    setTeamId("");
                  }
                }}
              >
                <SelectTrigger id="intake-queue-visibility">
                  <SelectValue>
                    {visibility === "team"
                      ? t("queue.team")
                      : t("queue.private")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t("queue.private")}</SelectItem>
                  {canShare && (
                    <SelectItem value="team">{t("queue.team")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {visibility === "team" && canShare && (
              <div className="space-y-2">
                <Label htmlFor="intake-queue-team">
                  {t("queue.selectTeam")}
                </Label>
                <Select
                  value={teamId}
                  onValueChange={(value) => setTeamId(value ?? "")}
                >
                  <SelectTrigger id="intake-queue-team">
                    <SelectValue placeholder={t("queue.selectTeam")}>
                      {teamId
                        ? (teams.data?.find((team) => team.id === teamId)
                            ?.name ?? t("queue.selectTeam"))
                        : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(teams.data ?? []).map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {queueId && queueDetail.isError && (
              <Alert variant="error" role="alert">
                <AlertDescription>{t("queue.loadFailed")}</AlertDescription>
              </Alert>
            )}
            {save.isError && (
              <Alert variant="error" role="alert">
                <AlertDescription>
                  {save.error instanceof HttpError && save.error.status === 409
                    ? t("queue.conflict")
                    : t("queue.saveFailed")}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => setDialogOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              disabled={
                !name.trim() ||
                save.isPending ||
                (queueId && (queueDetail.isLoading || queueDetail.isError)) ||
                (visibility === "team" && (!canShare || !teamId))
              }
              onClick={() => save.mutate()}
            >
              {queueId ? t("queue.update") : t("queue.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

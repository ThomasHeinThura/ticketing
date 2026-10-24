import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Skeleton,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { createTeam } from "@/fetchers/team";
import { teamsKey, useTeams } from "@/hooks/queries/team/use-teams";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

function CreateTeamDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createTeam(workspaceId, {
        name: name.trim(),
        capacityDaysPerWeek: capacity === "" ? null : Number(capacity),
      }),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: teamsKey(workspaceId) });
      onClose();
      void navigate({
        to: routes.workspaceTeamDetail.path,
        params: { id: team.id },
      });
    },
  });
  const capacityValid =
    capacity === "" ||
    (Number.isFinite(Number(capacity)) &&
      Number(capacity) >= 0 &&
      Number(capacity) <= 7);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{t("teams:create.title")}</DialogTitle>
          <DialogDescription>{t("teams:create.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && capacityValid && !mutation.isPending)
              mutation.mutate();
          }}
        >
          <div className="space-y-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="team-name">{t("teams:fields.name")}</Label>
              <Input
                id="team-name"
                autoFocus
                required
                maxLength={120}
                value={name}
                disabled={mutation.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-capacity">
                {t("teams:fields.capacity")}
              </Label>
              <Input
                id="team-capacity"
                type="number"
                min={0}
                max={7}
                step={0.5}
                value={capacity}
                disabled={mutation.isPending}
                onChange={(event) => setCapacity(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                {t("teams:fields.capacityHelp")}
              </p>
            </div>
            {mutation.error ? (
              <Alert variant="error">
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !name.trim() || !capacityValid}
            >
              {t("teams:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `docs/screens.md` "Workspace — teams": every team with its size, capacity and CAB flag. */
export function TeamsList() {
  const { t } = useTranslation();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const teams = useTeams(workspace?.id ?? "");
  const { canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const canManage = canManageWorkspaceSettings() && !isCheckingPermissions;
  const [creating, setCreating] = useState(false);
  const loading = workspaceLoading || teams.isLoading;
  return (
    <>
      <PageTitle title={t("teams:list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("teams:list.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("teams:list.description")}
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setCreating(true)} disabled={!workspace}>
              <Plus aria-hidden="true" />
              {t("teams:list.new")}
            </Button>
          ) : null}
        </div>
        {loading ? (
          <div
            role="status"
            aria-label={t("teams:list.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : teams.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("teams:list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("teams:list.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void teams.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("common:actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : teams.data?.length ? (
          <CardFrame>
            {teams.data.map((team) => (
              <Card key={team.id}>
                <CardHeader>
                  <CardTitle className="truncate">
                    <Link
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={routes.workspaceTeamDetail.path}
                      params={{ id: team.id }}
                    >
                      {team.name}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {t("teams:list.members", { count: team.memberCount })}
                    {team.capacityDaysPerWeek !== null
                      ? ` · ${t("teams:list.capacity", { days: team.capacityDaysPerWeek })}`
                      : ""}
                  </CardDescription>
                  {team.isCab ? (
                    <CardAction>
                      <Badge variant="info">{t("teams:badges.cab")}</Badge>
                    </CardAction>
                  ) : null}
                </CardHeader>
              </Card>
            ))}
          </CardFrame>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("teams:list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("teams:list.emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {creating && workspace ? (
        <CreateTeamDialog
          workspaceId={workspace.id}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

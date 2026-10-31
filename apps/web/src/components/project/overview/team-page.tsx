import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
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
import { Ellipsis, Plus, UserMinus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  addStakeholder,
  getProjectRoster,
  listStakeholders,
  type ProjectRoster,
  projectOverviewKeys,
  type Stakeholder,
  standDownStakeholder,
} from "@/fetchers/project/overview";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import {
  OptionSelect,
  Panel,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

/**
 * `/agent/projects/{key}/team`: stakeholders in escalation order (PR-12: stood down, never
 * deleted) and the read-only project roster. Stakeholder writes need `project:update`; the
 * roster is managed in project settings.
 */
export function TeamPage({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation("projectOverview");
  const { project, isLoading } = useProjectByKey(projectKey);
  const projectId = project?.id ?? "";
  const { canUpdateProjects } = useWorkspacePermission();
  const canUpdate = canUpdateProjects();
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [adding, setAdding] = useState(false);
  // PR-12: standing down cannot be reversed (the API has no re-activate), so it is confirmed.
  // The target outlives the open flag so the closing dialog keeps its name during exit.
  const [confirming, setConfirming] = useState<Stakeholder | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const stakeholders = useQuery({
    queryKey: projectOverviewKeys.stakeholders(projectId),
    queryFn: () => listStakeholders(projectId),
    enabled: Boolean(projectId),
  });
  const roster = useQuery({
    queryKey: projectOverviewKeys.roster(projectId),
    queryFn: () => getProjectRoster(projectId),
    enabled: Boolean(projectId),
  });
  const standDown = useMutation({
    mutationFn: (item: Stakeholder) => standDownStakeholder(projectId, item.id),
    onSuccess: async () => {
      setConfirmOpen(false);
      await refresh();
      toast.success(t("team.stoodDownToast"));
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.error(failure(error));
    },
  });

  if (isLoading || (projectId && stakeholders.isLoading))
    return (
      <div
        className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4 md:p-6"
        role="status"
        aria-label={t("loading")}
      >
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (!project || stakeholders.isError || !stakeholders.data)
    return (
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <Alert variant="error">
          <AlertDescription>
            {project ? t("team.loadFailed") : t("notFound")}
          </AlertDescription>
        </Alert>
      </div>
    );

  const people = stakeholders.data;
  const active = people.filter((person) => person.active);
  const nextOrder =
    active.reduce((max, person) => Math.max(max, person.escalationOrder), 0) +
    1;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6"
      data-testid="project-team-page"
    >
      <PageTitle title={t("team.pageTitle", { name: project.name })} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-lg">{t("team.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("team.description")}
          </p>
        </div>
        {canUpdate ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("team.add")}
          </Button>
        ) : null}
      </div>

      <Panel title={t("team.stakeholders")} testId="project-stakeholders">
        {people.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("team.emptyStakeholders")}
          </p>
        ) : (
          <ol className="flex flex-col divide-y">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 py-2"
                data-testid="project-stakeholder-row"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-xs tabular-nums",
                    !person.active && "text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {person.escalationOrder}
                </span>
                <span className="sr-only">
                  {t("team.escalationOrder", {
                    order: person.escalationOrder,
                  })}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-sm",
                      !person.active && "text-muted-foreground",
                    )}
                  >
                    {person.displayName ?? t("team.unnamed")}
                  </span>
                  <span className="truncate text-muted-foreground text-xs">
                    {person.role}
                    {person.escalationWaitMinutes > 0
                      ? ` · ${t("team.waitMinutes", { count: person.escalationWaitMinutes })}`
                      : ""}
                  </span>
                </div>
                {person.active ? null : (
                  <Badge variant="secondary">{t("team.stoodDown")}</Badge>
                )}
                {canUpdate && person.active ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={t("common.actionsFor", {
                            name: person.displayName ?? person.role,
                          })}
                        />
                      }
                    >
                      <Ellipsis className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem
                        onClick={() => {
                          setConfirming(person);
                          setConfirmOpen(true);
                        }}
                        data-testid="project-stakeholder-stand-down"
                      >
                        <UserMinus className="size-4" />
                        {t("team.standDown")}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel
        title={t("team.roster")}
        testId="project-roster"
        actions={
          <Button
            variant="ghost"
            size="sm"
            render={
              <Link
                to={routes.projectSettingsMembers.path}
                params={{ projectId }}
              />
            }
          >
            {t("team.manageRoster")}
          </Button>
        }
      >
        {roster.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : roster.isError || !roster.data ? (
          <p className="text-muted-foreground text-sm">
            {t("team.rosterUnavailable")}
          </p>
        ) : roster.data.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("team.emptyRoster")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {roster.data.members.map((member) => (
              <li
                key={`${member.personId}-${member.source}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">
                    {member.displayName ?? t("team.unnamed")}
                  </span>
                  {member.jobTitle ? (
                    <span className="truncate text-muted-foreground text-xs">
                      {member.jobTitle}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {member.source === "inherited" ? (
                    <Badge variant="outline">{t("team.inherited")}</Badge>
                  ) : null}
                  <Badge variant="secondary">{member.roleName}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !standDown.isPending) setConfirmOpen(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("team.standDownTitle", {
                name: confirming?.displayName ?? confirming?.role ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("team.standDownDescription", {
                name: confirming?.displayName ?? confirming?.role ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" disabled={standDown.isPending}>
                  {t("common.cancel")}
                </Button>
              }
            />
            <Button
              variant="destructive"
              loading={standDown.isPending}
              onClick={() => {
                if (confirming) standDown.mutate(confirming);
              }}
              data-testid="project-stakeholder-stand-down-confirm"
            >
              {t("team.standDownConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {adding ? (
        <StakeholderDialog
          projectId={projectId}
          roster={roster.data}
          nextOrder={nextOrder}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function StakeholderDialog({
  projectId,
  roster,
  nextOrder,
  onClose,
}: {
  projectId: string;
  roster: ProjectRoster | undefined;
  nextOrder: number;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const people = (roster?.members ?? []).filter((member) => member.active);
  const [personId, setPersonId] = useState(people[0]?.personId ?? "");
  const [role, setRole] = useState("");
  const [order, setOrder] = useState(String(nextOrder));
  const [wait, setWait] = useState("0");
  const [problem, setProblem] = useState<string | null>(null);
  const orderValue = Number(order);
  const waitValue = Number(wait);
  const valid =
    Boolean(personId) &&
    role.trim().length > 0 &&
    Number.isInteger(orderValue) &&
    orderValue >= 0 &&
    Number.isInteger(waitValue) &&
    waitValue >= 0;
  const save = useMutation({
    mutationFn: () =>
      addStakeholder(projectId, {
        personId,
        role: role.trim(),
        escalationOrder: orderValue,
        escalationWaitMinutes: waitValue,
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("team.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("team.addTitle")}</DialogTitle>
          <DialogDescription>{t("team.addDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          {people.length === 0 ? (
            <Alert variant="info">
              <AlertDescription>{t("team.noCandidates")}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stakeholder-person">{t("team.person")}</Label>
              <OptionSelect
                id="stakeholder-person"
                value={personId}
                options={people.map((member) => ({
                  value: member.personId,
                  label: member.displayName ?? t("team.unnamed"),
                }))}
                onChange={setPersonId}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stakeholder-role">{t("team.role")}</Label>
            <Input
              id="stakeholder-role"
              value={role}
              maxLength={100}
              placeholder={t("team.rolePlaceholder")}
              onChange={(event) => setRole(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stakeholder-order">{t("team.order")}</Label>
              <Input
                id="stakeholder-order"
                inputMode="numeric"
                value={order}
                onChange={(event) => setOrder(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="stakeholder-wait">{t("team.wait")}</Label>
              <Input
                id="stakeholder-wait"
                inputMode="numeric"
                value={wait}
                onChange={(event) => setWait(event.target.value)}
              />
            </div>
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
            disabled={!valid || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {t("team.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

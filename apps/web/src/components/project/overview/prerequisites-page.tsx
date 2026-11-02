import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Skeleton,
  Switch,
} from "@taskdesk/ui";
import { CheckCircle2, Circle, Ellipsis, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/common/date-field";
import PageTitle from "@/components/page-title";
import {
  createPrerequisite,
  deletePrerequisite,
  listPrerequisites,
  type Prerequisite,
  projectOverviewKeys,
  updatePrerequisite,
} from "@/fetchers/project/overview";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  formatDate,
  isPastDay,
  OptionSelect,
  useFailureMessage,
  useRefreshOverview,
} from "./overview-shared";

/** Open, dated, and its due day has passed in the viewer's time zone. */
export function isPrerequisiteOverdue(
  item: Pick<Prerequisite, "completedAt" | "dueDate">,
  now: Date = new Date(),
): boolean {
  return (
    !item.completedAt &&
    item.dueDate !== null &&
    isPastDay(String(item.dueDate), now)
  );
}

type OwnerSide = "us" | "customer" | "both";
const OWNER_SIDES: OwnerSide[] = ["us", "customer", "both"];

/**
 * `/agent/projects/{key}/prerequisites`: what the engagement is waiting on (PR-11: only staff
 * tick a prerequisite off; customers never reach this screen). Writes need `project:update`.
 */
export function PrerequisitesPage({ projectKey }: { projectKey: string }) {
  const { t, i18n } = useTranslation("projectOverview");
  const { project, isLoading } = useProjectByKey(projectKey);
  const projectId = project?.id ?? "";
  const { canUpdateProjects } = useWorkspacePermission();
  const canUpdate = canUpdateProjects();
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const openPendingAction = useOpenPendingAction();
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: projectOverviewKeys.prerequisites(projectId),
    queryFn: () => listPrerequisites(projectId),
    enabled: Boolean(projectId),
  });
  const toggle = useMutation({
    mutationFn: (item: Prerequisite) =>
      updatePrerequisite(projectId, item.id, { completed: !item.completedAt }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(failure(error)),
  });
  const remove = useMutation({
    mutationFn: (item: Prerequisite) => deletePrerequisite(projectId, item.id),
    onSuccess: (pending) => openPendingAction(pending),
    onError: (error) => toast.error(failure(error)),
  });

  if (isLoading || (projectId && query.isLoading))
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
  if (!project || query.isError || !query.data)
    return (
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <Alert variant="error">
          <AlertDescription>
            {project ? t("prerequisites.loadFailed") : t("notFound")}
          </AlertDescription>
        </Alert>
      </div>
    );

  const now = new Date();
  const items = [...query.data].sort(
    (a, b) =>
      Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) ||
      Number(b.isBlocking) - Number(a.isBlocking) ||
      (a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER) -
        (b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER),
  );
  const outstanding = items.filter((item) => !item.completedAt).length;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6"
      data-testid="project-prerequisites-page"
    >
      <PageTitle title={t("prerequisites.pageTitle", { name: project.name })} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-lg">{t("prerequisites.title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("prerequisites.summary", {
              outstanding,
              total: items.length,
            })}
          </p>
        </div>
        {canUpdate ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t("prerequisites.add")}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <Empty data-testid="project-prerequisites-empty">
          <EmptyHeader>
            <EmptyTitle>{t("prerequisites.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("prerequisites.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="divide-y">
          {items.map((item) => {
            const overdue = isPrerequisiteOverdue(item, now);
            const checkboxId = `prerequisite-${item.id}`;
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 px-4 py-3"
                data-testid="project-prerequisite-row"
              >
                {canUpdate ? (
                  <Checkbox
                    id={checkboxId}
                    className="mt-0.5"
                    checked={Boolean(item.completedAt)}
                    disabled={toggle.isPending}
                    onCheckedChange={() => toggle.mutate(item)}
                    aria-label={
                      item.completedAt
                        ? t("prerequisites.markOpen", { title: item.title })
                        : t("prerequisites.markDone", { title: item.title })
                    }
                  />
                ) : item.completedAt ? (
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-foreground"
                    aria-label={t("prerequisites.statusDone")}
                    role="img"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-label={t("prerequisites.statusOpen")}
                    role="img"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={cn(
                      "break-words text-sm",
                      item.completedAt && "text-muted-foreground line-through",
                    )}
                  >
                    {item.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant="outline">
                      {t(`prerequisites.owner.${item.ownerSide}`)}
                    </Badge>
                    {item.isBlocking ? (
                      <Badge
                        variant={item.completedAt ? "secondary" : "warning"}
                      >
                        {t("prerequisites.blocking")}
                      </Badge>
                    ) : null}
                    {item.dueDate ? (
                      <span
                        className={
                          overdue
                            ? "text-destructive-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {overdue
                          ? t("prerequisites.overdue", {
                              date: formatDate(
                                String(item.dueDate),
                                i18n.language,
                              ),
                            })
                          : t("prerequisites.due", {
                              date: formatDate(
                                String(item.dueDate),
                                i18n.language,
                              ),
                            })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {canUpdate ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={t("common.actionsFor", {
                            name: item.title,
                          })}
                        />
                      }
                    >
                      <Ellipsis className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem
                        variant="destructive"
                        onClick={() => remove.mutate(item)}
                      >
                        <Trash2 className="size-4" />
                        {t("common.delete")}
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}
      {adding ? (
        <PrerequisiteDialog
          projectId={projectId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function PrerequisiteDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("projectOverview");
  const failure = useFailureMessage();
  const refresh = useRefreshOverview(projectId);
  const [title, setTitle] = useState("");
  const [ownerSide, setOwnerSide] = useState<OwnerSide>("customer");
  const [dueDate, setDueDate] = useState("");
  const [isBlocking, setIsBlocking] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      createPrerequisite(projectId, {
        title: title.trim(),
        ownerSide,
        dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null,
        isBlocking,
      }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("prerequisites.saved"));
      onClose();
    },
    onError: (error) => setProblem(failure(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-md" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("prerequisites.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("prerequisites.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prerequisite-title">
              {t("prerequisites.fieldTitle")}
            </Label>
            <Input
              id="prerequisite-title"
              value={title}
              maxLength={200}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prerequisite-owner">
                {t("prerequisites.fieldOwner")}
              </Label>
              <OptionSelect
                id="prerequisite-owner"
                value={ownerSide}
                options={OWNER_SIDES.map((value) => ({
                  value,
                  label: t(`prerequisites.owner.${value}`),
                }))}
                onChange={setOwnerSide}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prerequisite-due">
                {t("prerequisites.fieldDue")}
              </Label>
              <DateField
                id="prerequisite-due"
                placeholder={t("common.pickDate")}
                label={t("prerequisites.fieldDue")}
                value={dueDate}
                onChange={setDueDate}
                clearLabel={t("contract.dialog.clearDate")}
                dateEntry={{
                  label: t("common:dateEntry", {
                    label: t("prerequisites.fieldDue"),
                  }),
                  invalidLabel: t("common:invalidDate"),
                  saveLabel: t("common.save"),
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="prerequisite-blocking">
              {t("prerequisites.fieldBlocking")}
            </Label>
            <Switch
              id="prerequisite-blocking"
              checked={isBlocking}
              onCheckedChange={setIsBlocking}
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
            disabled={!title.trim() || save.isPending}
            onClick={() => {
              setProblem(null);
              save.mutate();
            }}
          >
            {t("prerequisites.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useLocation } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Calendar,
  Dialog,
  DialogContent,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@taskdesk/ui";
import { produce } from "immer";
import {
  CalendarIcon,
  Check,
  FolderKanban,
  Plus,
  Search,
  Tag,
  UserIcon,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import CreateWorkItemStagedAttachments from "@/components/work-item/create-work-item-staged-attachments";
import { useCreateWorkItemAttachments } from "@/components/work-item/use-create-work-item-attachments";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import {
  CREATE_TASK_DIALOG_CLASS,
  CREATE_TASK_PROPERTY_BUTTON_CLASS,
  CreateTaskBody,
  CreateTaskDiscardDialog,
  CreateTaskFooter,
  CreateTaskHeader,
  CreateTaskPropertyRow,
  CreateTaskTitleInput,
} from "./create-task-presentation";

const TaskDescriptionEditor = lazy(
  () => import("@/components/task/task-description-editor"),
);

type CreateTaskModalProps = {
  open: boolean;
  onClose: () => void;
  status?: string;
  projectId?: string;
};

type Priority = "no-priority" | "low" | "medium" | "high" | "urgent";

type LabelColor =
  | "gray"
  | "dark-gray"
  | "purple"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "pink"
  | "red";

type Label = {
  id: string;
  name: string;
  color: string;
  taskId: string | null;
  workspaceId: string;
  createdAt: string;
};

type PopoverStep = "select" | "color";

function normalizeTask(
  task: Partial<Task> &
    Pick<
      Task,
      "id" | "title" | "status" | "projectId" | "createdAt" | "version"
    >,
): Task {
  return {
    ...task,
    number: task.number ?? null,
    description: task.description ?? null,
    priority: task.priority ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    position: task.position ?? 0,
    userId: task.userId ?? null,
    assigneeId: task.assigneeId ?? task.userId ?? null,
    assigneeName: task.assigneeName ?? null,
    assigneeImage: task.assigneeImage ?? null,
    labels: task.labels ?? [],
    externalLinks: task.externalLinks ?? [],
  };
}

function CreateTaskModal({
  open,
  onClose,
  status,
  projectId,
}: CreateTaskModalProps) {
  const { t } = useTranslation();
  const { project, setProject } = useProjectStore();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);

  const labelColors = useMemo(
    () =>
      [
        {
          value: "gray" as LabelColor,
          labelKey: "stone" as const,
          color: "var(--color-stone-500)",
        },
        {
          value: "dark-gray" as LabelColor,
          labelKey: "slate" as const,
          color: "var(--color-slate-500)",
        },
        {
          value: "purple" as LabelColor,
          labelKey: "lavender" as const,
          color: "var(--color-violet-500)",
        },
        {
          value: "teal" as LabelColor,
          labelKey: "sage" as const,
          color: "var(--color-emerald-600)",
        },
        {
          value: "green" as LabelColor,
          labelKey: "forest" as const,
          color: "var(--color-green-600)",
        },
        {
          value: "yellow" as LabelColor,
          labelKey: "amber" as const,
          color: "var(--color-amber-600)",
        },
        {
          value: "orange" as LabelColor,
          labelKey: "terracotta" as const,
          color: "var(--color-orange-600)",
        },
        {
          value: "pink" as LabelColor,
          labelKey: "rose" as const,
          color: "var(--color-rose-600)",
        },
        {
          value: "red" as LabelColor,
          labelKey: "crimson" as const,
          color: "var(--color-red-600)",
        },
      ].map(({ labelKey, ...rest }) => ({
        ...rest,
        label: t(`common:modals.createTask.labelColors.${labelKey}`),
      })),
    [t],
  );
  const location = useLocation();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id || "",
    open,
  );
  const { mutateAsync: createLabel } = useCreateLabel();
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(
    workspace?.id || "",
    open,
  );
  const { canCreateTasks, canCreateLabels } = useWorkspacePermission();
  const canCreateTaskCapability = canCreateTasks();
  const canCreateLabelCapability = canCreateLabels();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("no-priority");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [createMore, setCreateMore] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  // Set once the task exists, so a retry after a failed upload never creates a second task.
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  // True while the create request or the file uploads run: nothing can be edited, resubmitted
  // or closed, so one click never creates two tasks.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelsStep, setLabelsStep] = useState<PopoverStep>("select");
  const [searchValue, setSearchValue] = useState("");
  const [selectedColor, setSelectedColor] = useState<LabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");

  const routeProjectId =
    location.pathname.match(/\/project\/([^/]+)/)?.[1] ?? null;
  const explicitProjectId = projectId || routeProjectId || "";
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const resolvedProjectId =
    explicitProjectId || selectedProjectId || project?.id || "";
  const { data: workspaceProjects } = useGetProjects(
    { workspaceId: workspace?.id || "" },
    open,
  );
  const resolvedProject =
    // The store outlives navigation, so it only counts when it holds this very project.
    (project?.id === resolvedProjectId ? project : null) ??
    workspaceProjects?.find((p) => p.id === resolvedProjectId) ??
    null;
  const attachments = useCreateWorkItemAttachments(resolvedProjectId);
  // Once the task exists the form is read-only: a retry only uploads the remaining files.
  const locked = submitting || createdTask !== null;
  const createdKey =
    createdTask?.number != null && resolvedProject?.slug
      ? `${resolvedProject.slug}-${createdTask.number}`
      : null;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const didSubmitRef = useRef(false);

  const { mutateAsync: createTask } = useCreateTask();

  const filteredLabels = (() => {
    const searchFiltered = workspaceLabels.filter((label) =>
      label.name.toLowerCase().includes(searchValue.toLowerCase()),
    );

    const labelMap = new Map<string, (typeof workspaceLabels)[0]>();
    for (const label of searchFiltered) {
      const existing = labelMap.get(label.name);
      if (!existing || (label.taskId === null && existing.taskId !== null)) {
        labelMap.set(label.name, label);
      }
    }

    return Array.from(labelMap.values());
  })();

  const isCreatingNewLabel =
    searchValue &&
    !workspaceLabels.some(
      (label) => label.name.toLowerCase() === searchValue.toLowerCase(),
    );

  const hasUnsavedChanges = Boolean(
    title.trim() ||
      description.trim() ||
      priority !== "no-priority" ||
      assigneeId ||
      startDate ||
      dueDate ||
      selectedProjectId ||
      labels.length > 0 ||
      attachments.rows.length > 0,
  );

  const closeAndReset = () => {
    setDiscardConfirmationOpen(false);
    setTitle("");
    setDescription("");
    setPriority("no-priority");
    setAssigneeId("");
    setStartDate(undefined);
    setDueDate(undefined);
    setSelectedProjectId("");
    setCreateMore(false);
    setLabels([]);
    setLabelsStep("select");
    setSearchValue("");
    setSelectedColor("gray");
    setNewLabelName("");
    didSubmitRef.current = false;
    // Staged files live only in memory until the task exists: discarding drops them and
    // nothing was ever created on the server, so there is no draft to delete or approve.
    attachments.reset();
    setCreatedTask(null);
    onClose();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    if (submittingRef.current) return;

    // A created task is kept: closing is not a discard (nothing is lost or deleted).
    if (createdTask) {
      closeAndReset();
      return;
    }

    if (hasUnsavedChanges && !didSubmitRef.current) {
      setDiscardConfirmationOpen(true);
      return;
    }

    closeAndReset();
  };

  const syncTaskIntoProject = useCallback(
    (task: Task) => {
      if (!project) return;

      const updatedProject = produce(project, (draft) => {
        let existingTask:
          | (typeof draft.columns)[number]["tasks"][number]
          | undefined;

        for (const column of draft.columns ?? []) {
          const taskIndex = column.tasks.findIndex(
            (columnTask) => columnTask.id === task.id,
          );

          if (taskIndex !== -1) {
            existingTask = column.tasks[taskIndex];
            column.tasks.splice(taskIndex, 1);
            break;
          }
        }

        if (task.status === "planned" || task.status === "archived") {
          return;
        }

        const targetColumn = draft.columns?.find(
          (column) => column.id === task.status,
        );
        if (!targetColumn) return;

        targetColumn.tasks.push({
          ...existingTask,
          ...task,
          assigneeId: task.userId,
          assigneeName:
            workspaceUsers?.members?.find(
              (member) => member.userId === task.userId,
            )?.user?.name ??
            existingTask?.assigneeName ??
            null,
          assigneeImage:
            workspaceUsers?.members?.find(
              (member) => member.userId === task.userId,
            )?.user?.image ??
            existingTask?.assigneeImage ??
            null,
          position: task.position ?? 0,
        });
      });

      setProject(updatedProject);
    },
    [project, setProject, workspaceUsers?.members],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!title.trim() || !resolvedProjectId || !workspace?.id) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const taskStatus = status ?? "to-do";
      didSubmitRef.current = true;

      let savedTask = createdTask;
      if (!savedTask) {
        savedTask = normalizeTask(
          await createTask({
            title: title.trim(),
            description: description.trim() || "",
            userId: assigneeId,
            priority,
            projectId: resolvedProjectId,
            startDate: startDate ? startDate.toISOString() : undefined,
            dueDate: dueDate ? dueDate.toISOString() : undefined,
            status: taskStatus,
          }),
        );
        setCreatedTask(savedTask);
        for (const label of labels) {
          try {
            await createLabel({
              name: label.name,
              color: label.color,
              taskId: savedTask.id,
              workspaceId: workspace.id,
            });
          } catch (error) {
            console.error("Failed to create label:", error);
          }
        }
        syncTaskIntoProject(savedTask);
      }

      // Files staged while writing are uploaded now that the task exists.
      if (attachments.rows.length > 0) {
        if (savedTask.number == null || !resolvedProject?.slug) {
          didSubmitRef.current = false;
          toast.error(t("workItems:create.attachments.createUnknown"));
          return;
        }
        const complete = await attachments.upload(
          `${resolvedProject.slug}-${savedTask.number}`,
        );
        if (!complete) {
          didSubmitRef.current = false;
          toast.error(
            t("workItems:create.attachments.partial", {
              key: `${resolvedProject.slug}-${savedTask.number}`,
            }),
          );
          return;
        }
      }

      toast.success(t("common:modals.createTask.successCreated"));

      if (createMore) {
        setTitle("");
        setDescription("");
        setPriority("no-priority");
        setAssigneeId("");
        setStartDate(undefined);
        setDueDate(undefined);
        setLabels([]);
        setLabelsStep("select");
        setSearchValue("");
        setSelectedColor("gray");
        setNewLabelName("");
        didSubmitRef.current = false;
        attachments.reset();
        setCreatedTask(null);
      } else {
        closeAndReset();
      }
    } catch (error) {
      didSubmitRef.current = false;
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.createError"),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const priorityOptions = useMemo(
    () =>
      (["no-priority", "low", "medium", "high", "urgent"] as const).map(
        (value) => ({
          value,
          label: t(`tasks:priority.${value}`),
        }),
      ),
    [t],
  );

  const selectedPriority = priorityOptions.find((p) => p.value === priority);

  const statusLabel = useMemo(() => {
    if (status) {
      return t(`tasks:status.${status}`);
    }
    return t("tasks:status.in-progress");
  }, [status, t]);
  const selectedUser = workspaceUsers?.members?.find(
    (u) => u.userId === assigneeId,
  );

  useEffect(() => {
    if (labelsOpen && labelsStep === "select" && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [labelsOpen, labelsStep]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || discardConfirmationOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (title.trim() && resolvedProjectId && workspace?.id) {
          const form = document.querySelector("form");
          if (form) {
            form.dispatchEvent(
              new Event("submit", { cancelable: true, bubbles: true }),
            );
          }
        }
      }
    },
    [open, discardConfirmationOpen, title, resolvedProjectId, workspace?.id],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const resetLabelsPopover = () => {
    setLabelsStep("select");
    setSearchValue("");
    setNewLabelName("");
    setSelectedColor("gray");
  };

  const handleLabelsClose = () => {
    setLabelsOpen(false);
    setTimeout(resetLabelsPopover, 200);
  };

  const toggleLabel = (labelName: string) => {
    const existingLabel = labels.find((l) => l.name === labelName);
    if (existingLabel) {
      setLabels(labels.filter((l) => l.name !== labelName));
    } else {
      const workspaceLabel = workspaceLabels.find((l) => l.name === labelName);
      if (workspaceLabel) {
        setLabels([
          ...labels,
          {
            id: workspaceLabel.id,
            name: workspaceLabel.name,
            color: workspaceLabel.color,
            taskId: null,
            workspaceId: workspaceLabel.workspaceId || "",
            createdAt: workspaceLabel.createdAt,
          },
        ]);
      }
    }
  };

  const handleCreateNewClick = () => {
    setNewLabelName(searchValue);
    setLabelsStep("color");
  };

  const handleColorSelect = async (color: LabelColor) => {
    setSelectedColor(color);

    if (!newLabelName.trim() || !workspace?.id) return;

    try {
      const createdLabel = await createLabel({
        name: newLabelName.trim(),
        color: color,
        workspaceId: workspace.id,
      });

      const newLabel: Label = {
        id: createdLabel.id,
        name: createdLabel.name,
        color: createdLabel.color,
        taskId: createdLabel.taskId ?? null,
        workspaceId: createdLabel.workspaceId ?? workspace.id,
        createdAt: createdLabel.createdAt,
      };

      setLabels([...labels, newLabel]);
      toast.success(t("common:modals.createTask.labelCreated"));
      handleLabelsClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.labelCreateError"),
      );
    }
  };

  const removeLabel = (labelName: string) => {
    setLabels(labels.filter((l) => l.name !== labelName));
  };

  // Defense-in-depth: if the user lacks task-create permission, don't render
  // the modal even if a stale trigger somehow opens it (e.g., keyboard
  // shortcut after the capability has changed).
  if (!canCreateTaskCapability) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={CREATE_TASK_DIALOG_CLASS}
        showCloseButton={false}
      >
        <CreateTaskHeader
          projectLabel={
            resolvedProject?.slug?.toUpperCase() ||
            t("common:modals.createTask.breadcrumbTask")
          }
          title={t("common:modals.createTask.title")}
          description={t("common:modals.createTask.description")}
          breadcrumbLabel={t("common:breadcrumb.label")}
        />

        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 min-h-0 space-y-6"
        >
          <CreateTaskBody>
            <CreateTaskTitleInput
              unstyled
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder={t("common:modals.createTask.taskTitlePlaceholder")}
              required
              disabled={locked}
            />

            <div className="min-h-[200px]">
              <Suspense
                fallback={
                  <Skeleton className="min-h-44 w-full" aria-hidden="true" />
                }
              >
                <TaskDescriptionEditor
                  value={description}
                  onChange={setDescription}
                  placeholder={t(
                    "common:modals.createTask.descriptionPlaceholder",
                  )}
                  onFilesSelected={locked ? undefined : attachments.stage}
                  disabled={locked}
                />
              </Suspense>
            </div>

            <CreateWorkItemStagedAttachments
              rows={attachments.rows}
              onRemove={attachments.remove}
              disabled={submitting}
            />

            {createdTask && createdKey && !submitting ? (
              <Alert data-testid="create-task-partial">
                <AlertTitle>
                  {t("workItems:create.attachments.partial", {
                    key: createdKey,
                  })}
                </AlertTitle>
                <AlertDescription>
                  {t("workItems:create.attachments.afterCreate")}
                </AlertDescription>
              </Alert>
            ) : null}

            {labels.length > 0 && (
              <div className="flex flex-wrap mb-2">
                {labels.map((label) => (
                  <Badge
                    key={label.name}
                    color={label.color}
                    variant="outline"
                    className="flex items-center gap-1 pl-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => {
                      if (!locked) removeLabel(label.name);
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 mr-1.5 rounded-full"
                      style={{
                        backgroundColor: resolveLabelColor(label.color),
                      }}
                    />
                    <span className="max-w-20 truncate">{label.name}</span>
                  </Badge>
                ))}
              </div>
            )}

            <CreateTaskPropertyRow>
              {!explicitProjectId && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      disabled={locked}
                      variant="ghost"
                      type="button"
                      className={cn(
                        CREATE_TASK_PROPERTY_BUTTON_CLASS,
                        resolvedProjectId
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <FolderKanban className="w-3.5 h-3.5" />
                      <span>
                        {resolvedProject?.name ||
                          t("common:modals.createTask.selectProject")}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start">
                    <div className="space-y-1">
                      {workspaceProjects?.map((workspaceProject) => (
                        <Button
                          variant="ghost"
                          key={workspaceProject.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                          onClick={() =>
                            setSelectedProjectId(workspaceProject.id)
                          }
                        >
                          <span className="text-sm truncate">
                            {workspaceProject.name}
                          </span>
                          {resolvedProjectId === workspaceProject.id && (
                            <Check className="ml-auto h-4 w-4 shrink-0" />
                          )}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/50 text-foreground rounded-md text-xs font-medium border border-border">
                <div className="w-1.5 h-1.5 bg-foreground rounded-full" />
                {statusLabel}
              </div>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    disabled={locked}
                    variant="ghost"
                    type="button"
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      startDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {startDate
                        ? formatDateMedium(startDate)
                        : t("common:modals.createTask.startDate")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    className="w-full bg-popover"
                    weekStartsOn={weekStartsOn}
                  />
                  {startDate && (
                    <div className="p-2 border-t border-border">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setStartDate(undefined)}
                      >
                        {t("common:modals.createTask.clearStartDate")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    disabled={locked}
                    variant="ghost"
                    type="button"
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      priority !== "no-priority"
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {getPriorityIcon(priority)}
                    <span>
                      {selectedPriority
                        ? selectedPriority.label
                        : t("common:modals.createTask.priority")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <div className="space-y-1">
                    {priorityOptions.map((option) => (
                      <Button
                        variant="ghost"
                        key={option.value}
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                        onClick={() => setPriority(option.value as Priority)}
                      >
                        {getPriorityIcon(option.value)}
                        <span className="text-sm">{option.label}</span>
                        {priority === option.value && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    disabled={locked}
                    variant="ghost"
                    type="button"
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      selectedUser
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {selectedUser ? (
                      <>
                        <Avatar className="h-4 w-4">
                          <AvatarImage
                            src={selectedUser?.user?.image ?? ""}
                            alt={selectedUser?.user?.name || ""}
                          />
                          <AvatarFallback className="text-[10px] font-medium border border-border/30">
                            {getInitials(selectedUser?.user?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{selectedUser.user?.name}</span>
                      </>
                    ) : (
                      <>
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>{t("common:modals.createTask.assign")}</span>
                      </>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      type="button"
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                      onClick={() => setAssigneeId("")}
                    >
                      <div
                        className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
                        title={t(
                          "common:modals.createTask.assignUnassignedTitle",
                        )}
                      >
                        <span className="text-[10px] font-medium text-muted-foreground">
                          ?
                        </span>
                      </div>
                      <span className="text-sm">
                        {t("common:modals.createTask.assignUnassigned")}
                      </span>
                      {!assigneeId && <Check className="ml-auto h-4 w-4" />}
                    </Button>
                    {workspaceUsers?.members?.map((member) => (
                      <Button
                        variant="ghost"
                        key={member.userId}
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                        onClick={() => setAssigneeId(member.userId || "")}
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage
                            src={member?.user?.image ?? ""}
                            alt={member?.user?.name || ""}
                          />
                          <AvatarFallback className="text-xs font-medium border border-border/30">
                            {getInitials(member?.user?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{member?.user?.name}</span>
                        {assigneeId === member.userId && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    disabled={locked}
                    variant="ghost"
                    type="button"
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      dueDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {dueDate
                        ? formatDateMedium(dueDate)
                        : t("common:modals.createTask.dueDate")}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    className="w-full bg-popover"
                    weekStartsOn={weekStartsOn}
                  />
                  {dueDate && (
                    <div className="p-2 border-t border-border">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setDueDate(undefined)}
                      >
                        {t("common:modals.createTask.clearDueDate")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    disabled={locked}
                    variant="ghost"
                    type="button"
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      labels.length > 0
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>{t("common:modals.createTask.labels")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  {labelsStep === "select" && (
                    <div className="w-auto">
                      <div className="flex items-center gap-2 p-2 border-b border-border">
                        <Search className="w-3 h-3 text-muted-foreground" />
                        <Input
                          unstyled
                          nativeInput
                          ref={searchInputRef}
                          value={searchValue}
                          onChange={(e) => setSearchValue(e.target.value)}
                          placeholder={t(
                            "common:modals.createTask.searchLabels",
                          )}
                          className="relative inline-flex min-w-0 flex-1 w-full"
                          nativeInputClassName="w-full bg-transparent border-none text-foreground text-xs focus:outline-none placeholder:text-muted-foreground"
                        />
                      </div>

                      <div className="py-1">
                        {filteredLabels.length === 0 &&
                          searchValue.length === 0 && (
                            <span className="text-xs text-muted-foreground px-2">
                              {t("common:modals.createTask.noLabelsFound")}
                            </span>
                          )}
                        {filteredLabels.map((label) => (
                          <Button
                            variant="ghost"
                            key={label.id}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={() => toggleLabel(label.name)}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              {labels.some((l) => l.name === label.name) && (
                                <Check className="w-3 h-3" />
                              )}
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: resolveLabelColor(label.color),
                              }}
                            />
                            <span className="max-w-20 truncate">
                              {label.name}
                            </span>
                          </Button>
                        ))}

                        {canCreateLabelCapability &&
                          isCreatingNewLabel &&
                          filteredLabels.length > 0 && (
                            <div className="border-t border-border my-1" />
                          )}
                        {canCreateLabelCapability && isCreatingNewLabel && (
                          <Button
                            variant="ghost"
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={handleCreateNewClick}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              <Plus className="w-3 h-3" />
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor:
                                  labelColors.find(
                                    (c) => c.value === selectedColor,
                                  )?.color || "var(--color-neutral-400)",
                              }}
                            />
                            <span className="truncate">
                              {t("common:modals.createTask.createLabel", {
                                name: searchValue,
                              })}
                            </span>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {labelsStep === "color" && (
                    <div className="w-auto">
                      <div className="flex items-center justify-between p-2 border-b border-border">
                        <span className="text-xs font-medium">
                          {t("common:modals.createTask.chooseColor")}
                        </span>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => setLabelsStep("select")}
                          className="w-4 h-4 flex items-center justify-center hover:bg-accent/50 rounded"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="py-1">
                        {labelColors.map((color) => (
                          <Button
                            variant="ghost"
                            key={color.value}
                            type="button"
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left",
                              selectedColor === color.value && "bg-accent/30",
                            )}
                            onClick={() =>
                              handleColorSelect(color.value as LabelColor)
                            }
                          >
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color.color }}
                            />
                            <span className="truncate">{color.label}</span>
                            {selectedColor === color.value && (
                              <Check className="w-3 h-3 ml-auto" />
                            )}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </CreateTaskPropertyRow>
          </CreateTaskBody>

          <CreateTaskFooter
            createMore={createMore}
            onCreateMoreChange={setCreateMore}
            createMoreId="create-task-create-more"
            createMoreLabel={t("common:modals.createTask.createMore")}
            cancelLabel={
              createdTask
                ? t("workItems:create.attachments.createdClose")
                : t("common:actions.cancel")
            }
            submitLabel={
              submitting && createdTask
                ? t("workItems:create.attachments.uploading")
                : createdTask
                  ? t("workItems:create.attachments.retry")
                  : t("common:modals.createTask.createButton")
            }
            onCancel={() => handleOpenChange(false)}
            disabled={!title.trim() || submitting}
            pending={submitting}
          />
        </form>
      </DialogContent>

      <CreateTaskDiscardDialog
        open={discardConfirmationOpen}
        onOpenChange={setDiscardConfirmationOpen}
        onDiscard={closeAndReset}
        title={t("common:modals.createTask.discardTitle")}
        description={t(
          attachments.rows.length > 0
            ? "common:modals.createTask.discardWithFilesDescription"
            : "common:modals.createTask.discardDescription",
        )}
        cancelLabel={t("common:actions.cancel")}
        discardLabel={t("common:modals.createTask.discardButton")}
      />
    </Dialog>
  );
}

export default CreateTaskModal;

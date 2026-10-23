import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@taskdesk/ui";
import { Check, Layers, TriangleAlert } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CREATE_TASK_PROPERTY_BUTTON_CLASS,
  CREATE_TASK_PROPERTY_OPTION_CLASS,
  CreateTaskBody,
  CreateTaskFooter,
  CreateTaskTitleInput,
} from "@/components/shared/modals/create-task-presentation";
import { TASK_DESCRIPTION_EDITOR_CLASS } from "@/components/task/task-detail-presentation";
import useCreateWorkItem from "@/hooks/mutations/work-item/use-create-work-item";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import { dayToIso } from "@/lib/work-item-date";
import CreateWorkItemProperties from "./create-work-item-properties";
import CreateWorkItemStagedAttachments from "./create-work-item-staged-attachments";
import CreateWorkItemTemplatePicker from "./create-work-item-template-picker";
import { useCreateWorkItemAttachments } from "./use-create-work-item-attachments";
import {
  type CreateWorkItemLabel,
  useCreateWorkItemOptions,
} from "./use-create-work-item-options";

const CommentEditor = lazy(
  () => import("@/components/activity/comment-editor"),
);
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITY_OPTIONS)[number];
const NO_PRIORITY = "no-priority";
const TITLE_MAX_LENGTH = 500;
export type CreateWorkItemDraftState = {
  dirty: boolean;
  busy: boolean;
  createdKey?: string;
};
export type CreateWorkItemDialogProps = {
  onCancel?: () => void;
  onDraftStateChange?: (state: CreateWorkItemDraftState) => void;
  onClose: () => void;
  projectId: string;
  workspaceId: string | undefined;
};
type SubmitError = "forbidden" | "invalid" | "generic";

/** Kaneo's create composition over the canonical persisted create contract. No shadow task. */
export default function CreateWorkItemDialogForm({
  onClose,
  onCancel,
  onDraftStateChange,
  projectId,
  workspaceId,
}: CreateWorkItemDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | typeof NO_PRIORITY>(
    NO_PRIORITY,
  );
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [assigneeId, setAssigneeId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [createdLabels, setCreatedLabels] = useState<CreateWorkItemLabel[]>([]);
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelDraftDirty, setLabelDraftDirty] = useState(false);
  const [description, setDescription] = useState("");
  const [descriptionDocument, setDescriptionDocument] = useState<unknown>();
  const [createMore, setCreateMore] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [createUnconfirmed, setCreateUnconfirmed] = useState(false);
  const attachments = useCreateWorkItemAttachments(
    `${workspaceId}:${projectId}`,
  );
  const submission = useRef(false);
  const focusAfterCreate = useRef(false);
  const lifecycle = useIntentLifecycle(`${workspaceId}:${projectId}`, () => {
    setSubmitError(null);
    setCreatedKey(null);
    setCreateUnconfirmed(false);
    setUploadBusy(false);
    setCreatedLabels([]);
    setLabelBusy(false);
    setLabelDraftDirty(false);
  });
  const permission = useWorkspacePermission(workspaceId, projectId);
  const {
    data: types,
    isLoading: isLoadingTypes,
    isError: isTypesError,
    refetch: refetchTypes,
  } = useGetWorkItemTypes({ workspaceId });
  const selectedType = types?.find((type) => type.id === typeId);
  const canUpdate = permission.canUpdateTasks();
  const canAssign = permission.canAssignTasks();
  const canAttach =
    permission.canCreateAttachments?.() === true &&
    !permission.isCheckingPermissions;
  const catalogueOptions = useCreateWorkItemOptions({
    workspaceId,
    projectId,
    canUpdate,
    canAssign,
  });
  const options = {
    ...catalogueOptions,
    labels: [
      ...new Map(
        [
          ...catalogueOptions.labels,
          ...createdLabels.filter((label) => label.workspaceId === workspaceId),
        ].map((label) => [label.id, label]),
      ).values(),
    ],
  };
  const optionalFieldsValid =
    (!(startDate || dueDate || labelIds.length) || canUpdate) &&
    (!assigneeId ||
      ((canAssign || canUpdate) &&
        !options.peopleError &&
        !options.peopleLoading &&
        options.people.some((person) => person.personId === assigneeId))) &&
    (!labelIds.length ||
      (!options.labelsError &&
        !options.labelsLoading &&
        labelIds.every((id) =>
          options.labels.some((label) => label.id === id),
        )));
  const { mutateAsync, isPending } = useCreateWorkItem({
    projectId,
    typeId: typeId ?? "",
    title: title.trim(),
    description: description.trim() ? descriptionDocument : undefined,
    priority: priority === NO_PRIORITY ? undefined : priority,
    startDate: startDate ? dayToIso(startDate, null) : undefined,
    dueDate: dueDate ? dayToIso(dueDate, null) : undefined,
    assigneeId: assigneeId || undefined,
    labelIds: labelIds.length ? labelIds : undefined,
    templateId: templateId ?? undefined,
  });
  const busy = isPending || labelBusy || uploadBusy;
  const locked = busy || Boolean(createdKey) || createUnconfirmed;
  const dirty =
    !createdKey &&
    Boolean(
      attachments.rows.length ||
        title.trim() ||
        description.trim() ||
        priority !== NO_PRIORITY ||
        startDate ||
        dueDate ||
        assigneeId ||
        labelIds.length ||
        labelDraftDirty,
    );
  useEffect(() => {
    onDraftStateChange?.({
      dirty,
      busy,
      ...(createdKey ? { createdKey } : {}),
    });
  }, [dirty, busy, createdKey, onDraftStateChange]);
  useLayoutEffect(() => {
    if (focusAfterCreate.current && !isPending) {
      focusAfterCreate.current = false;
      titleRef.current?.focus();
    }
  });
  const canSubmit =
    title.trim().length > 0 &&
    title.trim().length <= TITLE_MAX_LENGTH &&
    !!selectedType &&
    !isLoadingTypes &&
    !isTypesError &&
    !locked &&
    (!attachments.rows.length || canAttach) &&
    !permission.isCheckingPermissions &&
    permission.canCreateTasks() &&
    optionalFieldsValid;
  function resetDraft() {
    attachments.reset();
    setCreatedKey(null);
    setCreateUnconfirmed(false);
    setTitle("");
    setDescription("");
    setDescriptionDocument(undefined);
    setPriority(NO_PRIORITY);
    setStartDate(undefined);
    setDueDate(undefined);
    setAssigneeId("");
    setLabelIds([]);
    setTemplateId(null);
    setCreatedLabels([]);
    setLabelDraftDirty(false);
    setSubmitError(null);
  }
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (
      submission.current ||
      busy ||
      (createdKey ? attachments.rows.length > 0 && !canAttach : !canSubmit)
    )
      return;
    submission.current = true;
    const intent = lifecycle.capture();
    setSubmitError(null);
    let confirmedKey = createdKey;
    try {
      if (!confirmedKey) {
        const result = await mutateAsync();
        if (result && typeof result.key === "string" && result.key) {
          confirmedKey = result.key;
          if (lifecycle.isCurrent(intent)) setCreatedKey(confirmedKey);
        } else if (attachments.rows.length) {
          throw new Error("Create result was not confirmed");
        }
        await queryClient.invalidateQueries({
          queryKey: ["work-items", projectId],
        });
        if (!lifecycle.isCurrent(intent)) return;
      }
      if (confirmedKey) {
        setUploadBusy(true);
        const complete = await attachments.upload(confirmedKey);
        if (!lifecycle.isCurrent(intent)) return;
        await queryClient.invalidateQueries({
          queryKey: ["work-items", "attachments", confirmedKey],
        });
        if (!complete) return;
      }
      if (!lifecycle.isCurrent(intent)) return;
      toast.success(t("workItems:create.success"));
      if (createMore) {
        focusAfterCreate.current = true;
        resetDraft();
      } else {
        onClose();
      }
    } catch (error) {
      if (!lifecycle.isCurrent(intent)) return;
      if (
        !confirmedKey &&
        (!(error instanceof HttpError) || error.status >= 500)
      )
        setCreateUnconfirmed(true);
      setSubmitError(
        error instanceof HttpError && error.status === 403
          ? "forbidden"
          : error instanceof HttpError &&
              (error.status === 400 || error.status === 422)
            ? "invalid"
            : "generic",
      );
    } finally {
      if (lifecycle.isCurrent(intent)) setUploadBusy(false);
      submission.current = false;
    }
  }
  const priorityLabel =
    priority === NO_PRIORITY
      ? t("workItems:create.priorityNone")
      : t(`workItems:list.priority.${priority}`);
  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col flex-1 min-h-0 space-y-6"
      noValidate
    >
      <CreateTaskBody>
        <CreateTaskTitleInput
          ref={titleRef}
          id="create-work-item-title"
          aria-label={t("workItems:create.fieldTitle")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX_LENGTH}
          placeholder={t("common:modals.createTask.taskTitlePlaceholder")}
          autoFocus
          required
          disabled={locked}
          data-testid="create-work-item-title"
        />
        <div className="min-h-[200px]">
          <Suspense
            fallback={
              <Skeleton className="min-h-44 w-full" aria-hidden="true" />
            }
          >
            <CommentEditor
              value={description}
              documentValue={descriptionDocument}
              onContentChange={({ text, document }) => {
                setDescription(text);
                setDescriptionDocument(document);
              }}
              placeholder={t("common:modals.createTask.descriptionPlaceholder")}
              ariaLabel={t("workItems:create.fieldDescription")}
              uploadSurface="description"
              onFilesSelected={
                canAttach && !locked ? attachments.stage : undefined
              }
              showQuickAttachButton={canAttach && !locked}
              className={TASK_DESCRIPTION_EDITOR_CLASS}
              disabled={locked}
            />
          </Suspense>
        </div>
        <CreateWorkItemStagedAttachments
          rows={attachments.rows}
          onRemove={attachments.remove}
          disabled={locked}
        />
        {createdKey ? (
          <Alert data-testid="create-work-item-partial">
            <AlertTitle>
              {t("workItems:create.attachments.partial", { key: createdKey })}
            </AlertTitle>
            <AlertDescription>
              {t("workItems:create.attachments.afterCreate")}
            </AlertDescription>
          </Alert>
        ) : null}
        {createUnconfirmed ? (
          <Alert variant="error">
            <AlertDescription>
              {t("workItems:create.attachments.createUnknown")}
            </AlertDescription>
          </Alert>
        ) : null}
        <CreateWorkItemProperties
          workspaceId={workspaceId}
          projectId={projectId}
          onLabelCreated={(label) => {
            setCreatedLabels((previous) => [
              ...previous.filter((existing) => existing.id !== label.id),
              label,
            ]);
            setLabelIds((previous) =>
              previous.includes(label.id) ? previous : [...previous, label.id],
            );
          }}
          onLabelBusyChange={setLabelBusy}
          onLabelDraftChange={setLabelDraftDirty}
          options={options}
          typeControl={
            <>
              <CreateWorkItemTemplatePicker
                workspaceId={workspaceId}
                selectedId={templateId}
                disabled={locked}
                onSelect={(template) => {
                  setTemplateId(template?.id ?? null);
                  if (!template) return;
                  // A template belongs to one type; its starting title only fills an empty title.
                  setTypeId(template.typeId);
                  setTitle((current) =>
                    current.trim() ? current : template.title,
                  );
                }}
              />
              <Popover open={typeOpen} onOpenChange={setTypeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t("workItems:create.fieldType")}
                    className={cn(
                      CREATE_TASK_PROPERTY_BUTTON_CLASS,
                      selectedType
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                    disabled={isLoadingTypes || isTypesError || locked}
                    data-testid="create-work-item-type-trigger"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>
                      {selectedType?.name ??
                        (isLoadingTypes
                          ? t("workItems:create.typesLoading")
                          : t("workItems:create.typePlaceholder"))}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <div className="space-y-1">
                    {(types ?? []).map((type) => (
                      <Button
                        key={type.id}
                        type="button"
                        variant="ghost"
                        className={CREATE_TASK_PROPERTY_OPTION_CLASS}
                        onClick={() => {
                          setTypeId(type.id);
                          // A template is bound to its type; choosing another type drops it.
                          if (type.id !== typeId) setTemplateId(null);
                          setTypeOpen(false);
                        }}
                      >
                        <span className="text-sm truncate">{type.name}</span>
                        {typeId === type.id ? (
                          <Check className="ml-auto h-4 w-4 shrink-0" />
                        ) : null}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </>
          }
          priorityControl={
            <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t("workItems:create.fieldPriority")}
                  className={cn(
                    CREATE_TASK_PROPERTY_BUTTON_CLASS,
                    priority !== NO_PRIORITY
                      ? "bg-accent/30 text-foreground"
                      : "text-muted-foreground",
                  )}
                  disabled={locked}
                  data-testid="create-work-item-priority-trigger"
                >
                  {getPriorityIcon(priority)}
                  <span>{priorityLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-1" align="start">
                <div className="space-y-1">
                  {[NO_PRIORITY, ...PRIORITY_OPTIONS].map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      className={CREATE_TASK_PROPERTY_OPTION_CLASS}
                      onClick={() => {
                        setPriority(value as Priority | typeof NO_PRIORITY);
                        setPriorityOpen(false);
                      }}
                    >
                      {getPriorityIcon(value)}
                      <span>
                        {value === NO_PRIORITY
                          ? t("workItems:create.priorityNone")
                          : t(`workItems:list.priority.${value}`)}
                      </span>
                      {priority === value ? (
                        <Check className="ml-auto h-4 w-4" />
                      ) : null}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          }
          startDate={startDate}
          dueDate={dueDate}
          assigneeId={assigneeId}
          labelIds={labelIds}
          onStartDateChange={setStartDate}
          onDueDateChange={setDueDate}
          onAssigneeChange={setAssigneeId}
          onLabelsChange={setLabelIds}
          canUpdate={canUpdate}
          canAssign={canAssign}
          disabled={locked}
        />

        {isTypesError ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-destructive-foreground">
              {t("workItems:create.typesError")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchTypes()}
            >
              {t("workItems:create.typesRetry")}
            </Button>
          </div>
        ) : null}
        {!isLoadingTypes && !isTypesError && types?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("workItems:create.noTypes")}
          </p>
        ) : null}
        {submitError ? (
          <Alert variant="error" data-testid="create-work-item-error">
            <TriangleAlert />
            <AlertTitle>{t("workItems:create.errorTitle")}</AlertTitle>
            <AlertDescription>
              <p>
                {t(
                  `workItems:create.error${submitError === "forbidden" ? "Forbidden" : submitError === "invalid" ? "Invalid" : "Generic"}`,
                )}
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
      </CreateTaskBody>
      <CreateTaskFooter
        createMore={createMore}
        onCreateMoreChange={setCreateMore}
        createMoreId="create-work-item-create-more"
        createMoreLabel={t("common:modals.createTask.createMore")}
        cancelLabel={t(
          createdKey
            ? "workItems:create.attachments.createdClose"
            : "workItems:create.cancel",
        )}
        submitLabel={t(
          uploadBusy
            ? "workItems:create.attachments.uploading"
            : createdKey
              ? "workItems:create.attachments.retry"
              : isPending
                ? "workItems:create.submitting"
                : "workItems:create.submit",
        )}
        onCancel={onCancel ?? onClose}
        disabled={
          createdKey
            ? busy || (attachments.rows.length > 0 && !canAttach)
            : !canSubmit
        }
        pending={busy}
        submitTestId="create-work-item-submit"
      />
    </form>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@taskdesk/ui";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useCreateWorkItem from "@/hooks/mutations/work-item/use-create-work-item";
import useGetWorkItemTypes from "@/hooks/queries/work-item/use-get-work-item-types";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { descriptionFromPlainText } from "@/lib/work-item-description";

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITY_OPTIONS)[number];
const NO_PRIORITY = "no-priority";

/** `WI-3`: title is required, 1-500 characters. The server re-validates; this is the
 * client-side mirror so the dialog can disable its submit rather than round-trip a 400. */
const TITLE_MAX_LENGTH = 500;

export type CreateWorkItemDialogProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workspaceId: string | undefined;
};

type SubmitError = "forbidden" | "invalid" | "generic";

/**
 * The create-work-item dialog (`docs/02-design/screen-inventory.md` "Create work item").
 *
 * Fields: Type (`WI-1` — required, no default exists, so it is the one selector the
 * dialog cannot omit; its options come from the new
 * `GET /api/workspace/{workspaceId}/work-item-types`), Title (`WI-3`), Description
 * (plain text for this slice — see `lib/work-item-description.ts` — wrapped into the
 * Tiptap document shape the rest of the app reads), and Priority (`WI-8` names
 * `work_item:set_priority` as the capability for THIS one field; the create ENDPOINT
 * accepts priority under `work_item:create` today, and nothing here widens that).
 *
 * Deliberately NOT here, each a separate later slice: assignee (`assignment.md`, and
 * nothing writes `assignee_id` yet), dates and labels (`WI-8`'s PATCH surface), templates
 * (`WI-5`), and the remaining type metadata.
 *
 * The dialog owns its own create call and, on success, invalidates the list query the
 * screen is already showing so the new item appears without a manual refresh.
 */
function CreateWorkItemDialog({
  open,
  onClose,
  projectId,
  workspaceId,
}: CreateWorkItemDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | typeof NO_PRIORITY>(
    NO_PRIORITY,
  );
  const [description, setDescription] = useState("");
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const {
    data: types,
    isLoading: isLoadingTypes,
    isError: isTypesError,
    refetch: refetchTypes,
  } = useGetWorkItemTypes({ workspaceId });

  const { mutateAsync, isPending } = useCreateWorkItem({
    projectId,
    typeId: typeId ?? "",
    title: title.trim(),
    description: descriptionFromPlainText(description),
    priority: priority === NO_PRIORITY ? undefined : priority,
  });

  const trimmedTitle = title.trim();
  const titleIsValid =
    trimmedTitle.length > 0 && trimmedTitle.length <= TITLE_MAX_LENGTH;
  const canSubmit = titleIsValid && typeId !== null && !isPending;

  // Base UI resolves what the trigger displays from `items` ---------------------------------
  // Without them, a selected value renders as the raw value (`kgffh54o...`, `high`), found in
  // browser verification of this very dialog. Every option rendered below must appear here.
  const typeItems = (types ?? []).map((type) => ({
    value: type.id,
    label: type.name,
  }));
  const priorityItems = [
    { value: NO_PRIORITY, label: t("workItems:create.priorityNone") },
    ...PRIORITY_OPTIONS.map((value) => ({
      value,
      label: t(`workItems:list.priority.${value}`, value),
    })),
  ];

  function reset() {
    setTitle("");
    setTypeId(null);
    setPriority(NO_PRIORITY);
    setDescription("");
    setSubmitError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitError(null);
    try {
      await mutateAsync();
      toast.success(t("workItems:create.success"));
      await queryClient.invalidateQueries({
        queryKey: ["work-items", projectId],
      });
      handleClose();
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) {
        setSubmitError("forbidden");
      } else if (error instanceof HttpError && error.status === 400) {
        setSubmitError("invalid");
      } else {
        setSubmitError("generic");
      }
    }
  }

  const submitErrorKey: Record<SubmitError, string> = {
    forbidden: t("workItems:create.errorForbidden"),
    invalid: t("workItems:create.errorInvalid"),
    generic: t("workItems:create.errorGeneric"),
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        showCloseButton
        closeLabel={t("workItems:create.close")}
        data-testid="create-work-item-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("workItems:create.title")}</DialogTitle>
          <DialogDescription>
            {t("workItems:create.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field>
            <FieldLabel htmlFor="create-work-item-type">
              {t("workItems:create.fieldType")}
            </FieldLabel>
            <Select
              items={typeItems}
              value={typeId}
              onValueChange={(value: string | null) => setTypeId(value)}
              disabled={isLoadingTypes || isTypesError}
            >
              <SelectTrigger
                id="create-work-item-type"
                className="w-full"
                data-testid="create-work-item-type-trigger"
              >
                <SelectValue
                  placeholder={
                    isLoadingTypes
                      ? t("workItems:create.typesLoading")
                      : t("workItems:create.typePlaceholder")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(types ?? []).map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isTypesError && (
              <FieldDescription className="flex items-center gap-2">
                <span className="text-destructive-foreground">
                  {t("workItems:create.typesError")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => refetchTypes()}
                >
                  {t("workItems:create.typesRetry")}
                </Button>
              </FieldDescription>
            )}
            {!isLoadingTypes &&
              !isTypesError &&
              types !== undefined &&
              types.length === 0 && (
                <FieldDescription>
                  {t("workItems:create.noTypes")}
                </FieldDescription>
              )}
          </Field>

          <Field>
            <FieldLabel htmlFor="create-work-item-title">
              {t("workItems:create.fieldTitle")}
            </FieldLabel>
            <Input
              id="create-work-item-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TITLE_MAX_LENGTH}
              placeholder={t("workItems:create.titlePlaceholder")}
              autoFocus
              data-testid="create-work-item-title"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="create-work-item-description">
              {t("workItems:create.fieldDescription")}
            </FieldLabel>
            <Textarea
              id="create-work-item-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("workItems:create.descriptionPlaceholder")}
              rows={4}
              data-testid="create-work-item-description"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="create-work-item-priority">
              {t("workItems:create.fieldPriority")}
            </FieldLabel>
            <Select
              items={priorityItems}
              value={priority}
              onValueChange={(value: string | null) =>
                setPriority(
                  (value ?? NO_PRIORITY) as Priority | typeof NO_PRIORITY,
                )
              }
            >
              <SelectTrigger
                id="create-work-item-priority"
                className="w-full"
                data-testid="create-work-item-priority-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRIORITY}>
                  {t("workItems:create.priorityNone")}
                </SelectItem>
                {PRIORITY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`workItems:list.priority.${value}`, value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {submitError && (
            <Alert variant="error" data-testid="create-work-item-error">
              <TriangleAlert />
              <AlertTitle>{t("workItems:create.errorTitle")}</AlertTitle>
              <AlertDescription>
                <p>{submitErrorKey[submitError]}</p>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              {t("workItems:create.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending
                ? t("workItems:create.submitting")
                : t("workItems:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateWorkItemDialog;

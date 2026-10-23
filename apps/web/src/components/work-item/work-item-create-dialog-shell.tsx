import { Dialog, DialogContent, ErrorBoundary } from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CREATE_TASK_DIALOG_CLASS,
  CreateTaskDiscardDialog,
  CreateTaskHeader,
} from "@/components/shared/modals/create-task-presentation";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import {
  CreateWorkItemDialogContent,
  CreateWorkItemDialogLoadError,
} from "./create-work-item-dialog";

import type { CreateWorkItemDraftState } from "./create-work-item-dialog-form";

export default function WorkItemCreateDialogShell({
  projectId,
  workspaceId,
  onClose,
  finalFocus,
}: {
  projectId: string;
  workspaceId: string | undefined;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CreateWorkItemDraftState>({
    dirty: false,
    busy: false,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  function requestClose() {
    if (draft.busy) return;
    if (draft.createdKey) onClose();
    else if (draft.dirty) setDiscardOpen(true);
    else onClose();
  }
  const { data: projects } = useGetProjects(
    { workspaceId: workspaceId ?? "" },
    Boolean(workspaceId),
  );
  const project = projects?.find((candidate) => candidate.id === projectId);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogContent
        className={CREATE_TASK_DIALOG_CLASS}
        showCloseButton={false}
        closeLabel={t("workItems:create.close")}
        data-testid="create-work-item-dialog"
        finalFocus={finalFocus}
      >
        <CreateTaskHeader
          projectLabel={
            project?.slug?.toUpperCase() ||
            t("common:modals.createTask.breadcrumbTask")
          }
          title={t("common:modals.createTask.title")}
          description={t("common:modals.createTask.description")}
          breadcrumbLabel={t("common:breadcrumb.label")}
        />
        <ErrorBoundary fallback={CreateWorkItemDialogLoadError}>
          <CreateWorkItemDialogContent
            onClose={onClose}
            onCancel={requestClose}
            onDraftStateChange={setDraft}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        </ErrorBoundary>
      </DialogContent>
      <CreateTaskDiscardDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onDiscard={onClose}
        title={t("common:modals.createTask.discardTitle")}
        description={t("common:modals.createTask.discardDescription")}
        cancelLabel={t("common:actions.cancel")}
        discardLabel={t("common:modals.createTask.discardButton")}
      />
    </Dialog>
  );
}

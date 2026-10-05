import { lazy, Suspense } from "react";

const CreateTaskModal = lazy(
  () => import("@/components/shared/modals/create-task-modal"),
);

export function BoardCreateTaskDialog({
  status,
  projectId,
  trigger,
  onClose,
}: {
  status: string | null;
  projectId: string;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
}) {
  if (status === null) return null;

  const handleClose = () => {
    onClose();
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  return (
    <Suspense fallback={null}>
      <CreateTaskModal
        open
        onClose={handleClose}
        projectId={projectId}
        status={status}
      />
    </Suspense>
  );
}

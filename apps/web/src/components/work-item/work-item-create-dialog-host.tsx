import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { markWorkItemCreateDialogOpen } from "./work-item-create-dialog-open";
import { loadWorkItemCreateDialogShell } from "./work-item-create-dialog-shell-loader";

type CreateDialogShell = Awaited<
  ReturnType<typeof loadWorkItemCreateDialogShell>
>["default"];

/**
 * Opens the one work-item create dialog from a screen other than the work route (the project
 * Overview, the command palette and its shortcut). Mount it while the dialog should be open; it
 * loads the shared dialog composition on first use and shows a toast, then closes, when that
 * fails. The work route and backlog open the same shell directly.
 */
export default function WorkItemCreateDialogHost({
  projectId,
  workspaceId,
  onClose,
  finalFocus,
  onReady,
}: {
  projectId: string;
  workspaceId: string | undefined;
  onClose: () => void;
  finalFocus: () => HTMLElement | false;
  /** The dialog code has loaded and the dialog is now showing. */
  onReady?: () => void;
}) {
  const { t } = useTranslation();
  const [Shell, setShell] = useState<CreateDialogShell>();
  const latest = useRef({ onClose, onReady, t });
  latest.current = { onClose, onReady, t };
  // Counts as an open dialog from the click, not only once its code has loaded.
  useEffect(() => markWorkItemCreateDialogOpen(), []);

  useEffect(() => {
    let cancelled = false;
    loadWorkItemCreateDialogShell().then(
      (module) => {
        if (cancelled) return;
        setShell(() => module.default);
        latest.current.onReady?.();
      },
      () => {
        if (cancelled) return;
        toast.error(latest.current.t("workItems:create.loadFailed"));
        latest.current.onClose();
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Shell) return null;
  return (
    <Shell
      projectId={projectId}
      workspaceId={workspaceId}
      onClose={onClose}
      finalFocus={finalFocus}
    />
  );
}

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import CommandPaletteLauncher from "@/components/command-palette/command-palette-launcher";
import usePendingActionDialogStore from "@/store/pending-action-dialog";

// Loaded only when a deletion request opens its approval, so it stays out of the entry chunk.
const PendingActionApprovalDialog = lazy(
  () => import("@/components/pending-action/pending-action-approval-dialog"),
);

// layout for the main app
export const Route = createFileRoute("/_layout")({
  component: RouteComponent,
  codeSplitGroupings: [],
});

function RouteComponent() {
  const approvalOpen = usePendingActionDialogStore(
    (state) => state.pendingActionId !== null,
  );
  return (
    <>
      <Outlet />
      <CommandPaletteLauncher />
      {approvalOpen ? (
        <Suspense fallback={null}>
          <PendingActionApprovalDialog />
        </Suspense>
      ) : null}
    </>
  );
}

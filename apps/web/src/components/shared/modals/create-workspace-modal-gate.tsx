import { lazy } from "react";
import NamespaceBoundary from "@/components/common/namespace-boundary";
import CreateWorkspaceModalSkeleton from "./create-workspace-modal-skeleton";

const loadModal = () => import("./create-workspace-modal");
const CreateWorkspaceModal = lazy(loadModal);

/**
 * The create-workspace dialog behind the namespace boundary: it reads the deferred `workspace`
 * namespace, and both the sidebar switcher and the command palette can open it before that group
 * lands. A shaped skeleton shows until the strings are in.
 */
export default function CreateWorkspaceModalGate({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <NamespaceBoundary
      preload={loadModal}
      fallback={(visible) => (
        <CreateWorkspaceModalSkeleton visible={visible} onClose={onClose} />
      )}
    >
      <CreateWorkspaceModal open onClose={onClose} />
    </NamespaceBoundary>
  );
}

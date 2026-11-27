import { DelayedSuspense } from "@taskdesk/ui";
import { lazy, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { TaskDetailsSheetFrame } from "@/components/task/task-details-sheet";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";
import type { WorkItemRow } from "@/types/work-item";
import { loadedModuleThenable } from "./loaded-module-thenable";
import WorkItemNamespaceBoundary from "./work-item-namespace-boundary";

type SidePaneBodyModule = typeof import("./work-item-side-pane-body");

let bodyModule: SidePaneBodyModule | undefined;

/**
 * Loader for the pane's body, kept here beside the boundary that gates it (the render-graph
 * guard reads the import and the boundary in one module). Once loaded it answers synchronously
 * (`loadedModuleThenable`), so a warmed pane opens without suspending or showing a skeleton.
 */
export function loadWorkItemSidePaneBody(): Promise<SidePaneBodyModule> {
  if (bodyModule) return loadedModuleThenable(bodyModule);
  return import("./work-item-side-pane-body").then((module) => {
    bodyModule = module;
    return module;
  });
}

const WorkItemSidePaneBody = lazy(loadWorkItemSidePaneBody);

/**
 * `docs/02-design/screen-inventory.md` "Work item — side pane" (`VW-4`, `?item={key}` on a
 * list, board, backlog, or saved view). Renders the work item's full detail view inside a
 * side pane without leaving the surrounding view.
 */
export default function WorkItemSidePane({
  itemKey,
  onClose,
  onReady,
  listRow,
}: {
  itemKey?: string;
  onClose: () => void;
  onReady?: (key?: string) => void;
  /** The list's row for `itemKey`, shown as the header until the item itself arrives. */
  listRow?: WorkItemRow;
}) {
  const { t } = useTranslation();
  useLayoutEffect(() => {
    onReady?.(itemKey);
  }, [itemKey, onReady]);

  return (
    <TaskDetailsSheetFrame
      itemId={itemKey}
      onClose={onClose}
      ariaLabel={t("workItems:sidePane.ariaLabel", { key: itemKey ?? "" })}
    >
      {(visibleItemKey) => (
        <DelayedSuspense
          fallback={(visible) => <WorkItemDetailLoading visible={visible} />}
        >
          <WorkItemNamespaceBoundary preload={loadWorkItemSidePaneBody}>
            <WorkItemSidePaneBody
              key={visibleItemKey}
              itemKey={visibleItemKey}
              onClose={onClose}
              listRow={listRow?.key === visibleItemKey ? listRow : undefined}
            />
          </WorkItemNamespaceBoundary>
        </DelayedSuspense>
      )}
    </TaskDetailsSheetFrame>
  );
}

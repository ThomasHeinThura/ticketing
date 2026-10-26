import { lazy, Suspense, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { TaskDetailsSheetFrame } from "@/components/task/task-details-sheet";
import WorkItemDetailLoading from "@/components/work-item/work-item-detail-loading";

const WorkItemSidePaneBody = lazy(() => import("./work-item-side-pane-body"));

/**
 * `docs/02-design/screen-inventory.md` "Work item — side pane" (`VW-4`, `?item={key}` on a
 * list, board, backlog, or saved view). Renders the work item's full detail view inside a
 * side pane without leaving the surrounding view.
 */
export default function WorkItemSidePane({
  itemKey,
  onClose,
  onReady,
}: {
  itemKey?: string;
  onClose: () => void;
  onReady?: (key?: string) => void;
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
        <Suspense fallback={<WorkItemDetailLoading />}>
          <WorkItemSidePaneBody
            key={visibleItemKey}
            itemKey={visibleItemKey}
            onClose={onClose}
          />
        </Suspense>
      )}
    </TaskDetailsSheetFrame>
  );
}

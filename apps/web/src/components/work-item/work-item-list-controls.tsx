import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { HttpError } from "@/lib/http-error";
import type { WorkItemFilterMode } from "@/lib/routes";

const WorkItemFilterEditor = lazy(
  () => import("@/components/work-item/work-item-filter-editor"),
);

/**
 * The structured filter controls of the work list (`SV-11`): the visual/text editor over the
 * one filter AST, with the server's refusal of the applied filter shown beside it. Export is
 * not part of this change (decision log 2026-10-11, F3 hold); this component renders no
 * export control and starts no download.
 */
export default function WorkItemListControls({
  filter,
  mode,
  workItemsError,
  onModeChange,
  onApply,
}: {
  filter: string;
  mode: WorkItemFilterMode;
  workItemsError?: unknown;
  onModeChange: (mode: WorkItemFilterMode) => void;
  onApply: (filter: string) => void;
}) {
  const { t } = useTranslation();
  const apiError =
    workItemsError instanceof HttpError &&
    [400, 403, 422].includes(workItemsError.status)
      ? `${workItemsError.status}: ${workItemsError.message}`
      : undefined;

  return (
    <Suspense
      fallback={
        <div
          className="h-12 rounded-md border bg-muted/30"
          role="status"
          aria-busy="true"
          aria-live="polite"
          data-testid="work-item-filter-loading"
        >
          <span className="sr-only">{t("workItems:filter.loading")}</span>
        </div>
      }
    >
      <WorkItemFilterEditor
        filter={filter}
        mode={mode}
        apiError={apiError}
        onModeChange={onModeChange}
        onApply={onApply}
      />
    </Suspense>
  );
}

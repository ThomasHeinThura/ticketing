import { Button } from "@taskdesk/ui";
import { Download, Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { HttpError } from "@/lib/http-error";
import type { WorkItemFilterMode } from "@/lib/routes";

const WorkItemFilterEditor = lazy(
  () => import("@/components/work-item/work-item-filter-editor"),
);
const WorkItemCreateTrigger = lazy(
  () => import("@/components/work-item/work-item-create-trigger"),
);

export default function WorkItemListControls({
  filter,
  mode,
  workItemsError,
  canCreate,
  createTriggerRef,
  isExporting,
  onCreate,
  onExport,
  onModeChange,
  onApply,
}: {
  filter: string;
  mode: WorkItemFilterMode;
  workItemsError?: unknown;
  canCreate: boolean;
  createTriggerRef: React.RefObject<HTMLButtonElement | null>;
  isExporting: boolean;
  onCreate: () => void;
  onExport: () => void;
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
    <>
      <div className="flex justify-end gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? <Loader2 className="animate-spin" /> : <Download />}
            {t("workItems:list.export")}
          </Button>
          {canCreate ? (
            <Suspense fallback={null}>
              <WorkItemCreateTrigger
                buttonRef={createTriggerRef}
                onClick={onCreate}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
      <Suspense
        fallback={
          <div
            className="h-12 rounded-md border bg-muted/30"
            role="status"
            aria-busy="true"
            aria-live="polite"
            data-testid="work-item-filter-loading"
          >
            <span className="sr-only">{t("common:empty.loading")}</span>
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
    </>
  );
}

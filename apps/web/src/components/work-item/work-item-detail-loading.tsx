import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/** Shared loading shape for the route boundary and the detail query. */
export default function WorkItemDetailLoading() {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="work-item-detail-loading"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("workItems:detail.loading")}</span>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-2/3" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-28" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

import { LoadingStatus, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/** Shared loading shape for the route boundary and the detail query. */
export default function WorkItemDetailLoading({
  visible = true,
  withHeader = true,
}: {
  visible?: boolean;
  /** False when the list row already shows the key and title above, so only the body is shaped. */
  withHeader?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <LoadingStatus visible={visible} label={t("workItems:detail.loading")}>
      <div
        className="flex flex-col gap-3"
        data-testid="work-item-detail-loading"
        aria-busy="true"
      >
        {withHeader ? (
          <>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-2/3" />
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    </LoadingStatus>
  );
}

import { LoadingStatus, Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

export default function WorkItemListLoading({
  visible = true,
}: {
  visible?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <LoadingStatus visible={visible} label={t("workItems:list.loading")}>
      <div
        className="flex flex-col gap-2"
        data-testid="work-item-list-loading"
        aria-busy="true"
      >
        {Array.from({ length: 6 }).map((_, index) => (
          // Skeleton rows have no identity to key on; the list is static in length and
          // never reordered while loading.
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder rows
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </LoadingStatus>
  );
}

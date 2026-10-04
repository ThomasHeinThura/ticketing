import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

export default function WorkItemListLoading() {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="work-item-list-loading"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("workItems:list.loading")}</span>
      {Array.from({ length: 6 }).map((_, index) => (
        // Skeleton rows have no identity to key on; the list is static in length and
        // never reordered while loading.
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder rows
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

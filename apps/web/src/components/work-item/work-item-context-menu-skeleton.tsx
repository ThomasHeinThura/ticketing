import { ContextMenuContent, LoadingStatus, Skeleton } from "@taskdesk/ui";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

/**
 * Label widths of the two rows of the controller's own loading menu: the copy-link item and the
 * disabled status item (`work-item-context-menu-content.tsx`).
 */
const ROW_WIDTHS = ["w-16", "w-20"] as const;

/**
 * Placeholder for the work-item context menu while its strings or code load. It has the geometry
 * of the controller's loading menu that takes over from it (same `w-46` popup, same two rows at
 * the real items' minimum height, no separator), so the handoff changes neither the popup's size
 * nor its position. The caller owns the ~150 ms delay and the minimum visible time, so nothing
 * paints until `visible` and a fast load never flashes it.
 */
export default function WorkItemContextMenuSkeleton({
  visible,
  keyboardAnchor,
}: {
  visible: boolean;
  keyboardAnchor?: ComponentProps<typeof ContextMenuContent>["anchor"];
}) {
  const { t } = useTranslation();
  return (
    <LoadingStatus visible={visible} label={t("common:empty.loading")}>
      {visible ? (
        <ContextMenuContent
          aria-busy="true"
          className="w-46"
          anchor={keyboardAnchor}
          data-testid="work-item-context-menu-loading"
        >
          {ROW_WIDTHS.map((width) => (
            <div
              key={width}
              className="flex min-h-8 items-center px-2 py-1 sm:min-h-7"
              data-testid="work-item-context-menu-loading-row"
            >
              <Skeleton className={`h-3.5 ${width}`} />
            </div>
          ))}
        </ContextMenuContent>
      ) : null}
    </LoadingStatus>
  );
}

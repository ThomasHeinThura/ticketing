import {
  ContextMenuContent,
  LoadingStatus,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

/** Label widths (rem) of the copy-link row and the four action rows of the real menu. */
const ROW_WIDTHS = ["w-16", "w-14", "w-12", "w-16", "w-20"] as const;

/**
 * Placeholder for the work-item context menu while its strings or code load. It reuses the
 * real menu's popup (same `w-46` width, padding, border and motion) and rows with the real
 * items' minimum height, plus the separator after the copy-link row, so the menu opens at its
 * final size and the real items replace it without a layout shift. Nothing paints until
 * `visible`, which the caller derives from the usual ~150 ms delay, so a fast load never flashes
 * it.
 */
export default function WorkItemContextMenuSkeleton({
  visible,
  keyboardAnchor,
}: {
  /** Overrides the built-in ~150 ms delay (the namespace boundary supplies its own). */
  visible?: boolean;
  keyboardAnchor?: ComponentProps<typeof ContextMenuContent>["anchor"];
}) {
  const { t } = useTranslation();
  const delayed = useDelayedPending(true);
  const shown = visible ?? delayed;
  return (
    <LoadingStatus visible={shown} label={t("common:empty.loading")}>
      {shown ? (
        <ContextMenuContent
          aria-busy="true"
          className="w-46"
          anchor={keyboardAnchor}
          data-testid="work-item-context-menu-loading"
        >
          {ROW_WIDTHS.map((width, index) => (
            <div key={width + String(index)}>
              {index === 1 ? (
                <div className="mx-2 my-1 h-px bg-border" aria-hidden="true" />
              ) : null}
              <div
                className="flex min-h-8 items-center px-2 py-1 sm:min-h-7"
                data-testid="work-item-context-menu-loading-row"
              >
                <Skeleton className={`h-3.5 ${width}`} />
              </div>
            </div>
          ))}
        </ContextMenuContent>
      ) : null}
    </LoadingStatus>
  );
}

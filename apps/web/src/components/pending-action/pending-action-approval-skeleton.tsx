import {
  DialogHeader,
  DialogPanel,
  LoadingStatus,
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/**
 * Placeholder inside the deletion-approval dialog while its strings load. It has the geometry of
 * the approval's own loading state that follows it (a header, then a `h-32` panel), with the
 * title as a bar the height of the title text, so the dialog neither resizes nor shifts between
 * the two. The dialog shell stays mounted around it. Nothing paints until `visible` (the caller's
 * ~150 ms delay).
 */
export default function PendingActionApprovalSkeleton({
  visible,
}: {
  visible: boolean;
}) {
  const { t } = useTranslation();
  const hidden = { visibility: visible ? "visible" : "hidden" } as const;
  return (
    <LoadingStatus visible={visible} label={t("common:empty.loading")}>
      <DialogHeader>
        <Skeleton className="h-5 w-44" style={hidden} />
      </DialogHeader>
      <DialogPanel aria-busy="true">
        <Skeleton
          className="h-32 w-full"
          style={hidden}
          data-testid="pending-action-approval-loading"
        />
      </DialogPanel>
    </LoadingStatus>
  );
}

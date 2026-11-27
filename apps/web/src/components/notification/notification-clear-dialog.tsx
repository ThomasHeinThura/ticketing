import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

/**
 * Confirms clearing every notification. It reads the deferred `notifications` namespace, so the
 * dropdown renders it only inside a `NamespaceBoundary` (`WORK_ROUTE_GATED_SURFACES`).
 */
export default function NotificationClearDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("notifications:clearDialogTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("notifications:clearDialogDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" size="sm" />}>
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <AlertDialogClose
            render={
              <Button variant="destructive" size="sm" onClick={onConfirm} />
            }
          >
            {t("common:actions.clearAll")}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { HistoryTarget } from "@/hooks/queries/settings/use-settings-history";
import { SettingsHistory } from "./settings-history";

/** One service key's History in a dialog, loaded only when it is opened. */
export default function ServiceKeyHistoryDialog({
  target,
  name,
  onClose,
}: {
  target: HistoryTarget;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {t("settings:serviceKeys.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <SettingsHistory target={target} />
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}

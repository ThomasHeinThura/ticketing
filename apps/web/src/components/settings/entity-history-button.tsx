import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@taskdesk/ui";
import { History } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HistoryTarget } from "@/query-client/settings-history-key";

const SettingsHistory = lazy(() =>
  import("@/components/settings/settings-history").then((m) => ({
    default: m.SettingsHistory,
  })),
);

/** A row action that opens one entity's History in a dialog; the History chunk loads on first open. */
export function EntityHistoryButton({
  target,
  name,
}: {
  target: HistoryTarget;
  name: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("settings:history.entityLabel", { name })}
        onClick={() => setOpen(true)}
      >
        <History aria-hidden="true" />
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent
            className="max-w-xl"
            closeLabel={t("common:actions.close")}
          >
            <DialogHeader>
              <DialogTitle>{t("settings:history.title")}</DialogTitle>
              <DialogDescription>{name}</DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Suspense fallback={null}>
                <SettingsHistory target={target} />
              </Suspense>
            </DialogPanel>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

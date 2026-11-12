import { toastManager } from "@taskdesk/ui";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

/** One reference notification for each distinct server failure, replacing the previous one. */
export function ServerErrorNotifications() {
  const { t } = useTranslation(undefined, { useSuspense: false });
  const currentToast = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const listener = (event: Event) => {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : undefined;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("reference" in detail) ||
        !("status" in detail)
      )
        return;
      const { reference, status } = detail;
      if (
        typeof reference !== "string" ||
        !/^[0-9a-f]{32}$/.test(reference) ||
        typeof status !== "number" ||
        status < 500 ||
        !Number.isInteger(status) ||
        seen.current.has(reference)
      )
        return;
      seen.current.add(reference);
      if (seen.current.size > 256) {
        const oldest = seen.current.values().next().value;
        if (oldest) seen.current.delete(oldest);
      }
      if (currentToast.current) toastManager.close(currentToast.current);
      currentToast.current = toastManager.add({
        title: t("common:error.serverReferenceToast", { id: reference }),
        type: "error",
        priority: "low",
        actionProps: {
          children: t("common:error.copyReference"),
          onClick: () => {
            void navigator.clipboard?.writeText(reference).catch(() => {});
          },
        },
      });
    };
    window.addEventListener("taskdesk:server-error", listener);
    return () => window.removeEventListener("taskdesk:server-error", listener);
  }, [t]);
  return null;
}

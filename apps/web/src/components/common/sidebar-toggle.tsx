import { SidebarTrigger } from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { afterPrimaryContent } from "@/lib/after-primary-content";

// The tooltip pulls in the popup runtime; the trigger paints without it and gains its
// tooltip once the page's primary content is up (G11).
const SidebarToggleTooltip = lazy(() => import("./sidebar-toggle-tooltip"));

let tooltipReady = false;

/** The header's sidebar toggle, as on kaneo's workspace pages. */
export default function SidebarToggle() {
  const { t } = useTranslation();
  const [withTooltip, setWithTooltip] = useState(tooltipReady);
  useEffect(() => {
    if (tooltipReady) return;
    let cancelled = false;
    void afterPrimaryContent().then(() => {
      tooltipReady = true;
      if (!cancelled) setWithTooltip(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const trigger = (
    <SidebarTrigger
      className="-ml-1 h-6 w-6"
      toggleLabel={t("common:a11y.toggleSidebar")}
    />
  );
  if (!withTooltip) return trigger;
  return (
    <Suspense fallback={trigger}>
      <SidebarToggleTooltip>{trigger}</SidebarToggleTooltip>
    </Suspense>
  );
}

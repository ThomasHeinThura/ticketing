import { SidebarTrigger } from "@taskdesk/ui";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const hadFocus = useRef(false);
  useEffect(() => {
    if (tooltipReady) return;
    const abort = new AbortController();
    afterPrimaryContent({ signal: abort.signal }).then(
      () => {
        tooltipReady = true;
        if (abort.signal.aborted) return;
        // Wrapping the trigger in the tooltip remounts the button; keep keyboard focus.
        hadFocus.current =
          wrapperRef.current?.contains(document.activeElement) ?? false;
        setWithTooltip(true);
      },
      () => {},
    );
    return () => abort.abort();
  }, []);
  useLayoutEffect(() => {
    if (!hadFocus.current) return;
    const button = wrapperRef.current?.querySelector("button");
    if (!button) return;
    hadFocus.current = false;
    button.focus();
  });
  const trigger = (
    <SidebarTrigger
      className="-ml-1 h-6 w-6"
      toggleLabel={t("common:a11y.toggleSidebar")}
    />
  );
  return (
    <span ref={wrapperRef} className="contents">
      {withTooltip ? (
        <Suspense fallback={trigger}>
          <SidebarToggleTooltip>{trigger}</SidebarToggleTooltip>
        </Suspense>
      ) : (
        trigger
      )}
    </span>
  );
}

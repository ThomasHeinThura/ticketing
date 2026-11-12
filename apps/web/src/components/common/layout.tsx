import { SidebarInset, SidebarProvider, useIsMobile } from "@taskdesk/ui";
import type React from "react";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseSidebarSheetOnNavigate } from "@/components/close-sidebar-sheet-on-navigate";
import { afterPrimaryContent } from "@/lib/after-primary-content";
import { cn } from "@/lib/cn";
import { importWithRetry, resettableLazy } from "@/lib/lazy-retry";
import { useUserPreferencesStore } from "@/store/user-preferences";

// The sidebar (workspace switcher, navigation, projects, notifications) loads beside the
// page instead of in front of it, so a page's own content is never held behind the
// sidebar's code (G11 work-list LCP).
// A failed download is tried again, and a final failure is not kept, so the next call (a
// later page, or the reload the error screen offers) imports it afresh.
let sidebarModule:
  | Promise<typeof import("@/components/app-sidebar")>
  | undefined;
export function loadSidebarModule() {
  if (!sidebarModule) {
    const pending = importWithRetry(() => import("@/components/app-sidebar"));
    sidebarModule = pending;
    pending.catch(() => {
      if (sidebarModule === pending) sidebarModule = undefined;
    });
    // The sidebar's last readiness boundary is its lazy project navigation.
    // Download it alongside the sidebar after primary content, rather than
    // starting a second network wave only once the sidebar has rendered.
    // The sidebar still owns rendering and its existing Suspense fallback.
    void import("@/components/nav-projects").catch(() => {});
  }
  return sidebarModule;
}
// A failed import replaces the lazy component too, so the next render imports afresh.
const AppSidebar = resettableLazy(() =>
  loadSidebarModule().then((module) => ({
    default: module.AppSidebar,
  })),
);

type LayoutProps = {
  children: ReactNode;
  className?: string;
};

type HeaderProps = {
  children: ReactNode;
  className?: string;
};

type ContentProps = {
  children: ReactNode;
  className?: string;
};

function LayoutHeader({ children, className }: HeaderProps) {
  return (
    <header
      className={cn(
        "flex h-10 shrink-0 gap-2 transition-[width,height] ease-in-out group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-8 border-b border-border bg-card p-2",
        className,
      )}
    >
      {children}
    </header>
  );
}

function LayoutContent({ children, className }: ContentProps) {
  return (
    <div className={cn("flex-1 min-h-0", className)}>
      <div className="h-full">{children}</div>
    </div>
  );
}

// Once the sidebar has mounted after a first paint, later pages show it straight away.
let sidebarReady = false;

// Below `lg` the sidebar is the off-canvas sheet, so a 768 px tablet gives pages the full
// width instead of about 520 px beside the docked sidebar (UX-10).
const SIDEBAR_SHEET_BREAKPOINT = 1024;

function Layout({ children, className }: LayoutProps) {
  const { t } = useTranslation();
  const { sidebarDefaultOpen } = useUserPreferencesStore();
  const sheetSidebar = useIsMobile(SIDEBAR_SHEET_BREAKPOINT);
  // The page paints first (on the work list and boards, its rows); the sidebar mounts once
  // the main thread is idle after that (G11).
  const [showSidebar, setShowSidebar] = useState(sidebarReady);
  useEffect(() => {
    if (sidebarReady) return;
    const abort = new AbortController();
    afterPrimaryContent({
      signal: abort.signal,
      onPrimaryContentReady: () => {
        void loadSidebarModule().catch(() => {});
      },
    }).then(
      () => {
        if (abort.signal.aborted) return;
        sidebarReady = true;
        setShowSidebar(true);
      },
      () => {},
    );
    return () => abort.abort();
  }, []);
  // Below lg the sidebar is a sheet over the page, so there is no docked width to hold.
  const placeholder =
    sidebarDefaultOpen && !sheetSidebar ? (
      // Same width as the sidebar it stands in for (none when collapsed), so nothing shifts.
      // `peer` + `data-variant="inset"` give the inset the same margins the real inset sidebar
      // does, so nothing shifts when it arrives.
      <div
        aria-hidden="true"
        className="peer hidden w-(--sidebar-width) shrink-0 lg:block"
        data-variant="inset"
        data-state="expanded"
      />
    ) : null;

  return (
    <div className="flex w-full bg-background">
      <SidebarProvider
        defaultOpen={sidebarDefaultOpen}
        mobileBreakpoint={SIDEBAR_SHEET_BREAKPOINT}
        // WCAG 2.4.1: the first Tab stop skips the sidebar to the inset `main`.
        skipLinkLabel={t("common:a11y.skipToContent")}
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 60)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <CloseSidebarSheetOnNavigate />
        {showSidebar ? (
          <Suspense fallback={placeholder}>
            <AppSidebar.Component />
          </Suspense>
        ) : (
          placeholder
        )}
        <SidebarInset
          className={cn(
            // Phones drop the card's margin, radius and border so content gets the full width.
            "m-2 flex flex-1 flex-col overflow-auto rounded-xl border border-border/80 bg-background shadow-sm/5 max-md:m-0 max-md:rounded-none max-md:border-0 max-md:shadow-none",
            className,
          )}
        >
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

Layout.Header = LayoutHeader;
Layout.Content = LayoutContent;

export default Layout;

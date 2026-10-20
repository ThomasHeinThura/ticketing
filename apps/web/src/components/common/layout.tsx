import { SidebarInset, SidebarProvider } from "@taskdesk/ui";
import type React from "react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { afterFirstPaint } from "@/lib/i18n/after-first-paint";
import { useUserPreferencesStore } from "@/store/user-preferences";

// The sidebar (workspace switcher, navigation, projects, notifications) loads beside the
// page instead of in front of it, so a page's own content is never held behind the
// sidebar's code (G11 work-list LCP).
const AppSidebar = lazy(() =>
  import("@/components/app-sidebar").then((module) => ({
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

function Layout({ children, className }: LayoutProps) {
  const { sidebarDefaultOpen } = useUserPreferencesStore();
  // The page paints first; the sidebar mounts once the main thread is idle (G11).
  const [showSidebar, setShowSidebar] = useState(sidebarReady);
  useEffect(() => {
    if (sidebarReady) return;
    let cancelled = false;
    void afterFirstPaint().then(() => {
      sidebarReady = true;
      if (!cancelled) setShowSidebar(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const placeholder = sidebarDefaultOpen ? (
    // Same width as the sidebar it stands in for (none when collapsed), so nothing shifts.
    <div
      aria-hidden="true"
      className="hidden w-(--sidebar-width) shrink-0 md:block"
    />
  ) : null;

  return (
    <div className="flex w-full bg-background">
      <SidebarProvider
        defaultOpen={sidebarDefaultOpen}
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 60)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        {showSidebar ? (
          <Suspense fallback={placeholder}>
            <AppSidebar />
          </Suspense>
        ) : (
          placeholder
        )}
        <SidebarInset
          className={cn(
            "m-2 flex flex-1 flex-col overflow-auto rounded-xl border border-border/80 bg-background shadow-sm/5",
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

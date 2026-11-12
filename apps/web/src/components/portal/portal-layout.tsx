import { SidebarInset, SidebarProvider, SidebarTrigger } from "@taskdesk/ui";
import type { CSSProperties, ReactNode } from "react";
import PageTitle from "@/components/page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalLazyContent } from "./portal-lazy-content";
import type { PortalShellUser } from "./portal-user-menu";

const PortalSidebar = portalLazyContent(
  () => import("./portal-sidebar"),
  <div
    aria-hidden="true"
    className="peer hidden w-(--sidebar-width) shrink-0 md:block"
    data-variant="inset"
    data-state="expanded"
  />,
);
const PortalTopbar = portalLazyContent<{ user: PortalShellUser }>(
  () =>
    import("./portal-topbar").then((module) => {
      module.preloadPortalTopbarContent();
      return module;
    }),
  <div className="h-9 flex-1" />,
);
const PortalAnnouncementBanner = portalLazyContent(
  () => import("./announcements/portal-announcement-banner"),
  null,
);
export function preloadPortalChrome() {
  void Promise.allSettled([
    PortalSidebar.preload(),
    PortalTopbar.preload(),
    PortalAnnouncementBanner.preload(),
  ]);
}

/** Kaneo sidebar/inset shell with the customer top bar; the inset is the page's one `main`. */
export default function PortalLayout({
  children,
  user,
}: {
  children: ReactNode;
  user: PortalShellUser;
}) {
  const { t } = usePortalTranslation("portal");
  return (
    <div className="flex w-full bg-background">
      {/* Until a page names itself (every portal page renders a PortalPageTitle). */}
      <PageTitle fallback hideAppName title={t("navigation.title")} />
      <SidebarProvider
        // WCAG 2.4.1: the first Tab stop skips the sidebar to the inset `main`.
        skipLinkLabel={t("common:a11y.skipToContent")}
        style={
          { "--sidebar-width": "calc(var(--spacing) * 60)" } as CSSProperties
        }
      >
        <PortalSidebar />
        <SidebarInset className="m-2 flex flex-1 flex-col overflow-auto rounded-xl border border-border/80 bg-background shadow-sm/5">
          <header className="sticky top-0 z-10 flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 sm:h-12 sm:py-0">
            <SidebarTrigger toggleLabel={t("common:a11y.toggleSidebar")} />
            <PortalTopbar user={user} />
          </header>
          <PortalAnnouncementBanner />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

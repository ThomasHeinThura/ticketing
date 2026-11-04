import { SidebarInset, SidebarProvider, SidebarTrigger } from "@taskdesk/ui";
import { type CSSProperties, lazy, type ReactNode, Suspense } from "react";
import PageTitle from "@/components/page-title";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import type { PortalShellUser } from "./portal-user-menu";

// Navigation and the top bar load separately from page content (G11 portal budget).
const PortalSidebar = lazy(() => import("./portal-sidebar"));
const PortalTopbar = lazy(() => import("./portal-topbar"));
// D7: active incident and maintenance announcements, loaded after the shell.
const PortalAnnouncementBanner = lazy(
  () => import("./announcements/portal-announcement-banner"),
);

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
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="peer hidden w-(--sidebar-width) shrink-0 md:block"
              data-variant="inset"
              data-state="expanded"
            />
          }
        >
          <PortalSidebar />
        </Suspense>
        <SidebarInset className="m-2 flex flex-1 flex-col overflow-auto rounded-xl border border-border/80 bg-background shadow-sm/5">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
            <SidebarTrigger toggleLabel={t("common:a11y.toggleSidebar")} />
            <Suspense fallback={<div className="h-9 flex-1" />}>
              <PortalTopbar user={user} />
            </Suspense>
          </header>
          <Suspense fallback={null}>
            <PortalAnnouncementBanner />
          </Suspense>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

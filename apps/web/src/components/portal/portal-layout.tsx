import { Link, useLocation } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@taskdesk/ui";
import { type CSSProperties, lazy, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/routes";

const PortalSidebar = lazy(() => import("./portal-sidebar"));

/** Kaneo sidebar/inset shell; customer navigation loads separately from page content. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation("portal");
  const location = useLocation();
  const titles = [
    [routes.portalHome.path, "navigation.home"],
    [routes.portalCatalogue.path, "navigation.catalogue"],
    [routes.portalRequests.path, "navigation.requests"],
    [routes.portalApprovals.path, "navigation.approvals"],
  ];
  const current =
    titles.find(([path]) => path === location.pathname)?.[1] ??
    "navigation.request";
  return (
    <div className="flex w-full bg-background">
      <SidebarProvider
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
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card p-2">
            <SidebarTrigger toggleLabel={t("common:a11y.toggleSidebar")} />
            <nav
              aria-label={t("navigation.breadcrumb")}
              className="flex items-center gap-2 text-sm"
            >
              <Link to={routes.portalHome.path}>{t("navigation.title")}</Link>
              <span aria-hidden="true">/</span>
              <span>{t(current)}</span>
            </nav>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}

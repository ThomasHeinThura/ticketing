import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { routes } from "@/lib/portal-route-builders";

const TABS = [
  { key: "announcements", to: routes.portalAnnouncements.path },
  { key: "releaseNotes", to: routes.portalReleases.path },
] as const;

/** Announcements and release notes share the sidebar's Announcements entry; each keeps its URL. */
export function PortalAnnouncementsTabs() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <nav
      aria-label={t("portal:announcements.tabs.label")}
      className="flex flex-wrap gap-1"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.to;
        return (
          <Button
            key={tab.key}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            aria-current={active ? "page" : undefined}
            render={<Link to={tab.to} />}
          >
            {t(`portal:announcements.tabs.${tab.key}`)}
          </Button>
        );
      })}
    </nav>
  );
}

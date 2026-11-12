import { createFileRoute } from "@tanstack/react-router";
import { PortalAnnouncementsList } from "@/components/portal/announcements/portal-announcements-list";
import {
  parsePortalAnnouncementsSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

export const Route = createFileRoute("/announcements")({
  validateSearch: parsePortalAnnouncementsSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: Announcements,
});

function Announcements() {
  const { cursor } = Route.useSearch();
  const { portalUserId } = Route.useRouteContext();
  return <PortalAnnouncementsList scope={portalUserId} cursor={cursor} />;
}

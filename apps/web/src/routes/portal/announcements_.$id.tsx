import { createFileRoute } from "@tanstack/react-router";
import { PortalAnnouncementDetail } from "@/components/portal/announcements/portal-announcement-detail";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/portal-route-search";

export const Route = createFileRoute("/announcements_/$id")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: Announcement,
});

function Announcement() {
  const { id } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalAnnouncementDetail id={id} scope={portalUserId} />;
}

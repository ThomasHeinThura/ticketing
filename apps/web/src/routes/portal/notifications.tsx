import { createFileRoute } from "@tanstack/react-router";
import { PortalNotificationInbox } from "@/components/portal/portal-notification-inbox";
import {
  parsePortalInboxSearch,
  portalProjectSearchMiddlewares,
  routes,
} from "@/lib/routes";

export const Route = createFileRoute("/notifications")({
  validateSearch: parsePortalInboxSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalNotificationsPage,
});

function PortalNotificationsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PortalNotificationInbox
      filter={search.filter ?? "all"}
      onFilterChange={(filter) =>
        void navigate({
          to: routes.portalInbox.path,
          search: filter === "all" ? {} : { filter },
        })
      }
    />
  );
}

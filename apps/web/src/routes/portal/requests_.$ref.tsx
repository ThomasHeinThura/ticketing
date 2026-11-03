import { createFileRoute } from "@tanstack/react-router";
import { PortalRequestDetails } from "@/components/portal/requests/portal-request-details";
import {
  parsePortalProjectSearch,
  portalProjectSearchMiddlewares,
} from "@/lib/routes";

/** U-12 (D6): a request the team raised for the customer, opened from the case list. */
export const Route = createFileRoute("/requests_/$ref")({
  validateSearch: parsePortalProjectSearch,
  search: { middlewares: portalProjectSearchMiddlewares },
  component: PortalRequest,
});

function PortalRequest() {
  const { ref } = Route.useParams();
  const { portalUserId } = Route.useRouteContext();
  return <PortalRequestDetails portalUserId={portalUserId} requestRef={ref} />;
}

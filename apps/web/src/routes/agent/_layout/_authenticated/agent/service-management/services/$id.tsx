import { createFileRoute } from "@tanstack/react-router";
import { ServiceDetailView } from "@/components/service-management/service-detail";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/service-management/services/$id",
)({
  component: ServiceDetailRoute,
});

function ServiceDetailRoute() {
  const { id } = Route.useParams();
  return <ServiceDetailView serviceId={id} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { CustomerInvitations } from "@/components/settings/customer-invitations/customer-invitations";
import { parseCustomerInvitationsSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/customer-invitations",
)({
  validateSearch: parseCustomerInvitationsSearch,
  component: CustomerInvitationsRoute,
});

function CustomerInvitationsRoute() {
  const { organisation } = Route.useSearch();
  return <CustomerInvitations organisationId={organisation} />;
}

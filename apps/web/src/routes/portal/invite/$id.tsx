import { createFileRoute } from "@tanstack/react-router";
import { AcceptInvitation } from "@/components/portal/accept-invitation";

export const Route = createFileRoute("/invite/$id")({
  component: InviteRoute,
});

function InviteRoute() {
  const { id } = Route.useParams();
  return <AcceptInvitation invitationId={id} />;
}

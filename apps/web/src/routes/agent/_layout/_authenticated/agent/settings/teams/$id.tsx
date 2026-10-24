import { createFileRoute } from "@tanstack/react-router";
import { TeamDetailView } from "@/components/settings/teams/team-detail";
import { parseTeamDetailSearch } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/teams/$id",
)({
  validateSearch: parseTeamDetailSearch,
  component: TeamDetailRoute,
});

function TeamDetailRoute() {
  const { id } = Route.useParams();
  const { inactive } = Route.useSearch();
  return <TeamDetailView teamId={id} showInactive={inactive === true} />;
}

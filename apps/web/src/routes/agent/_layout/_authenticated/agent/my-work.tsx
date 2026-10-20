import { createFileRoute } from "@tanstack/react-router";
import MyWork from "@/components/work-item/my-work";
import { type AgentMyWorkSearch, parseAgentMyWorkSearch } from "@/lib/routes";

export const Route = createFileRoute("/_layout/_authenticated/agent/my-work")({
  validateSearch: parseAgentMyWorkSearch,
  component: MyWorkRouteComponent,
});

function MyWorkRouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const update = (patch: Record<string, unknown>) =>
    void navigate({
      search: (prev: AgentMyWorkSearch) =>
        parseAgentMyWorkSearch({ ...prev, ...patch }),
      replace: true,
    });
  return (
    <MyWork
      lens={search.lens ?? "assigned"}
      item={search.item}
      onLensChange={(lens) =>
        update({ lens: lens === "assigned" ? undefined : lens })
      }
      onItemChange={(item) => update({ item })}
    />
  );
}

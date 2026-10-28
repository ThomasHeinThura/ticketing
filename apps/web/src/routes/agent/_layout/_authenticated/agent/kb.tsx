import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KbList } from "@/components/kb/agent/kb-list";
import { parseKbListSearch } from "@/lib/routes";

/** `docs/screens.md` "Knowledge base list" (P5, `KB-*`): articles, categories and the report. */
export const Route = createFileRoute("/_layout/_authenticated/agent/kb")({
  validateSearch: parseKbListSearch,
  component: KbRoute,
});

function KbRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <KbList
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KbArticleView } from "@/components/kb/agent/kb-article-view";
import { parseKbArticleSearch } from "@/lib/routes";

/** `docs/screens.md` "Article view" (P5): the article, its version history and its feedback. */
export const Route = createFileRoute("/_layout/_authenticated/agent/kb_/$id")({
  validateSearch: parseKbArticleSearch,
  component: KbArticleRoute,
});

function KbArticleRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <KbArticleView
      id={id}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

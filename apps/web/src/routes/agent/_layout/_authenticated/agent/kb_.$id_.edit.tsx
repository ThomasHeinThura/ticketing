import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KbArticleEditor } from "@/components/kb/agent/kb-article-editor";
import { parseKbEditorSearch } from "@/lib/routes";

/** `docs/screens.md` "Article editor" (P5): Kaneo's rich-text editor with a customer preview. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/kb_/$id_/edit",
)({
  validateSearch: parseKbEditorSearch,
  component: KbArticleEditRoute,
});

function KbArticleEditRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <KbArticleEditor
      id={id}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import SavedViewDetail from "@/components/saved-view/saved-view-detail";
import { parseSavedViewUrlSearch, routes } from "@/lib/routes";

/**
 * `docs/02-design/screen-inventory.md` "Saved view" (`/agent/views/{id}`). The screen lives in
 * `components/saved-view/saved-view-detail.tsx`; this file only binds it to the route's params
 * and search, and exports nothing but `Route`, so the router can split it from the entry.
 */
export const Route = createFileRoute("/_layout/_authenticated/agent/views/$id")(
  {
    validateSearch: parseSavedViewUrlSearch,
    component: SavedViewRoute,
  },
);

function SavedViewRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <SavedViewDetail
      id={id}
      search={search}
      onReplaceSearch={(next) => void navigate({ search: next, replace: true })}
      onOpenView={(viewId, next) =>
        void navigate({
          to: routes.savedView.path,
          params: { id: viewId },
          search: next,
        })
      }
    />
  );
}

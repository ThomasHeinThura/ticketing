import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { IdentityConnectionEditor } from "@/components/god-mode/identity-connection-editor";
import { IdentityConnectionEvents } from "@/components/god-mode/identity-connection-events";
import { ScimMatchAttributesSettings } from "@/components/god-mode/scim-match-attributes-settings";
import PageTitle from "@/components/page-title";
import { parseIdentityConnectionEventsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/authentication/$id",
)({
  validateSearch: parseIdentityConnectionEventsSearch,
  component: IdentityConnectionEditorRoute,
});

function IdentityConnectionEditorRoute() {
  const { id } = Route.useParams();
  const { eventsCursor } = Route.useSearch();
  const navigate = Route.useNavigate();
  const creating = id === "new";

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-y-auto p-6">
      <PageTitle
        title={
          creating ? "Add identity connection" : "Identity connection settings"
        }
      />
      <Button
        render={<a href={routes.identityConnections.build()} />}
        variant="outline"
      >
        Back to identity connections
      </Button>
      <IdentityConnectionEditor connectionId={creating ? null : id} />
      {!creating ? (
        <>
          <ScimMatchAttributesSettings connectionId={id} />
          <IdentityConnectionEvents
            connectionId={id}
            cursor={eventsCursor}
            onCursorChange={(nextCursor) =>
              void navigate({
                search: { eventsCursor: nextCursor },
              })
            }
          />
        </>
      ) : null}
    </main>
  );
}

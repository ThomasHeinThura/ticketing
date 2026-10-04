import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { IdentityConnectionEditor } from "@/components/god-mode/identity-connection-editor";
import { ScimMatchAttributesSettings } from "@/components/god-mode/scim-match-attributes-settings";
import PageTitle from "@/components/page-title";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/god-mode/authentication/$id",
)({ component: IdentityConnectionEditorRoute });

function IdentityConnectionEditorRoute() {
  const { id } = Route.useParams();
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
      {!creating ? <ScimMatchAttributesSettings connectionId={id} /> : null}
    </main>
  );
}

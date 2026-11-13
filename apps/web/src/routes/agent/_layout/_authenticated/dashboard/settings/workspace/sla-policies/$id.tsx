import { createFileRoute } from "@tanstack/react-router";
import { useSettingsAccess } from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
import { SlaPolicyEditor } from "@/components/sla-policy/sla-policy-editor";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/sla-policies/$id",
)({
  component: SlaPolicyEditorRoute,
});

function SlaPolicyEditorRoute() {
  const { id } = Route.useParams();
  return id === "new" ? <NewSlaPolicy /> : <SlaPolicyEditor id={id} />;
}

function NewSlaPolicy() {
  const access = useSettingsAccess((permission) =>
    permission.canManageServiceCalendars(),
  );
  if (access !== "allowed")
    return (
      <SettingsAccessPage
        access={access}
        titleKey="slaPolicies:editor.newTitle"
      />
    );
  return <SlaPolicyEditor id="new" />;
}

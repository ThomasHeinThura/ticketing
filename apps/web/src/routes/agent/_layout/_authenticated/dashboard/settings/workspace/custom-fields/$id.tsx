import { createFileRoute } from "@tanstack/react-router";
import { CustomFieldEditor } from "@/components/settings/custom-fields/custom-field-editor";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/custom-fields/$id",
)({
  component: CustomFieldEditorRoute,
});

function CustomFieldEditorRoute() {
  const { id } = Route.useParams();
  return <CustomFieldEditor fieldId={id} />;
}

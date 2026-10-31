import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "@/components/project/overview/documents-page";

/** S3 project Overview tab: `/agent/projects/{key}/documents`. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/documents",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectKey } = Route.useParams();
  return <DocumentsPage projectKey={projectKey} />;
}

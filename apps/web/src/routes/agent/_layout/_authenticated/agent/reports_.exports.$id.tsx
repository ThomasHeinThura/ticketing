import { createFileRoute } from "@tanstack/react-router";
import { ReportExportPage } from "@/components/reports/report-export-page";

/**
 * `docs/screens.md` "Report export" (P5, `RP-10`, P5-R3-01): the "export ready" email's link.
 * Under the authenticated shell, so a signed-out recipient signs in and returns here.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/reports_/exports/$id",
)({
  component: ReportExportRoute,
});

function ReportExportRoute() {
  const { id } = Route.useParams();
  return <ReportExportPage exportId={id} />;
}

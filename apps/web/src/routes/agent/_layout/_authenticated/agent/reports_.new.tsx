import { createFileRoute } from "@tanstack/react-router";
import { ReportBuilder } from "@/components/reports/report-builder";
import { parseReportBuilderSearch } from "@/lib/report-search";

/** `docs/screens.md` "Report builder" (P5, tier 3); `view` opens a saved chart report. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/reports_/new",
)({
  validateSearch: parseReportBuilderSearch,
  component: ReportBuilderRoute,
});

function ReportBuilderRoute() {
  return <ReportBuilder search={Route.useSearch()} />;
}

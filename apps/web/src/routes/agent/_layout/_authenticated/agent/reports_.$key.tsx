import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ReportDetail } from "@/components/reports/report-detail";
import { parseReportSearch } from "@/lib/report-search";

/** `docs/screens.md` "Report detail" (P5, `RP-8`): the full filter state is in the URL. */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/reports_/$key",
)({
  validateSearch: parseReportSearch,
  component: ReportDetailRoute,
});

function ReportDetailRoute() {
  const { key } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ReportDetail
      reportKey={key}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

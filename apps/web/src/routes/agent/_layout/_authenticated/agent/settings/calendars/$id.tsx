import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ServiceCalendarEditorView } from "@/components/service-calendar/service-calendar-editor-view";
import { useServiceCalendarEditor } from "@/hooks/use-service-calendar-editor";
import { routes } from "@/lib/routes";
import { useServerToday } from "@/lib/server-clock";
import { parseCalendarEditorSearch } from "@/lib/service-calendar-form";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/calendars/$id",
)({
  validateSearch: parseCalendarEditorSearch,
  component: ServiceCalendarEditorRoute,
});

function ServiceCalendarEditorRoute() {
  const { id: calendarId } = Route.useParams();
  const search = Route.useSearch();
  // Without `?year=` the preview shows the server's current year, not the browser's.
  const serverYear = useServerToday().getFullYear();
  const year = search.year ?? serverYear;
  const navigate = useNavigate({ from: Route.fullPath });
  const isNew = calendarId === "new";
  const state = useServiceCalendarEditor({
    calendarId,
    isNew,
    year,
    onCreated: async (id, selectedYear) => {
      await navigate({
        to: routes.serviceCalendarEditor.path,
        params: { id },
        search: { year: selectedYear },
        replace: true,
      });
    },
  });

  return (
    <ServiceCalendarEditorView
      state={state}
      isNew={isNew}
      year={year}
      form={state.form}
      onYearChange={(selectedYear) =>
        void navigate({ search: { year: selectedYear }, replace: true })
      }
    />
  );
}

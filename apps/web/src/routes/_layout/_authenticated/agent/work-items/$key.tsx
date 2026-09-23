import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";

/**
 * Stub for `docs/02-design/screen-inventory.md`'s "Work item — full page"
 * (`/agent/work-items/{key}`, P1, ⬜ — not built by this pull request). Registered so
 * the work-item list's row links (`lib/routes.ts`'s `routes.workItemDetail`) resolve to
 * a real, honest "not built yet" page instead of a 404 or a dangling, unregistered
 * route. The real detail page (state/priority/assignee header, description, activity,
 * relations, etc. — `docs/03-features/work-items.md` § Screens) is separate, later work.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/work-items/$key",
)({
  component: WorkItemDetailStubComponent,
});

function WorkItemDetailStubComponent() {
  const { t } = useTranslation();
  const { key } = Route.useParams();

  return (
    <>
      <PageTitle title={key} />
      <div className="flex h-full items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{key}</EmptyTitle>
            <EmptyDescription>
              {t("workItems:detail.notBuiltYet")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </>
  );
}

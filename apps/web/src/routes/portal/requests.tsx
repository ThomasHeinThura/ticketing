import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { PortalRequestState } from "@/components/portal/portal-request-state";
import { PortalSlaStatus } from "@/components/portal/portal-sla-status";
import { getPortalSubmissions } from "@/fetchers/intake";
import { readPortalSla } from "@/lib/portal-request";
import { parsePortalRequestsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute("/requests")({
  validateSearch: parsePortalRequestsSearch,
  component: PortalRequestsPage,
});

function PortalRequestsPage() {
  const { t } = useTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const { cursor } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useQuery({
    queryKey: ["portal", portalUserId, "submissions", cursor],
    queryFn: () => getPortalSubmissions({ cursor }),
  });

  const submissions = query.data?.submissions ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("requests.title", { defaultValue: "My requests" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("requests.description", {
              defaultValue:
                "Track requests you submitted or can view across your organisation.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button render={<Link to={routes.portalCatalogue.path} />}>
            {t("requests.newRequest", { defaultValue: "New request" })}
          </Button>
        </div>
      </header>

      {query.isError ? (
        <Alert variant="error">
          <AlertTitle>
            {t("error.title", { defaultValue: "Unable to load requests" })}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>{t("requests.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("common:actions.tryAgain", { defaultValue: "Try again" })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : submissions.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t("requests.emptyTitle", {
                    defaultValue: "No requests found",
                  })}
                </EmptyTitle>
                <EmptyDescription>
                  {t("requests.emptyDescription", {
                    defaultValue:
                      "You haven't submitted any service requests yet.",
                  })}
                </EmptyDescription>
              </EmptyHeader>
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  render={<Link to={routes.portalCatalogue.path} />}
                >
                  {t("requests.browseCatalogue", {
                    defaultValue: "Browse request catalogue",
                  })}
                </Button>
              </div>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("requests.reference")}</TableHead>
                <TableHead>{t("requests.type")}</TableHead>
                <TableHead>{t("requests.status")}</TableHead>
                <TableHead>{t("requests.due")}</TableHead>
                <TableHead>{t("requests.visibility")}</TableHead>
                <TableHead>{t("requests.submitted")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((sub) => (
                <TableRow key={sub.ref}>
                  <TableCell className="font-medium">
                    <Link
                      to={routes.portalSubmission.path}
                      params={{ ref: sub.ref }}
                      className="text-primary hover:underline"
                    >
                      {sub.ref}
                    </Link>
                  </TableCell>
                  <TableCell>{sub.requestTypeName}</TableCell>
                  <TableCell>
                    <PortalRequestState
                      state={sub.state}
                      customerStatus={
                        (sub as { customerStatus?: string }).customerStatus
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <PortalSlaStatus
                      sla={readPortalSla((sub as { sla?: unknown }).sla)}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sub.customerVisibility === "organisation"
                      ? t("intake.visibilityOrganisation", {
                          defaultValue: "Organisation",
                        })
                      : t("intake.visibilityPrivate", {
                          defaultValue: "Private",
                        })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(sub.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <nav
        aria-label={t("requests.pagination")}
        className="flex items-center justify-between gap-2"
      >
        {cursor ? (
          <Button
            variant="outline"
            onClick={() => void navigate({ search: {} })}
          >
            {t("requests.latest")}
          </Button>
        ) : (
          <span />
        )}
        {query.data?.page.hasMore && query.data.page.nextCursor ? (
          <Button
            variant="outline"
            onClick={() =>
              void navigate({
                search: { cursor: query.data?.page.nextCursor ?? undefined },
              })
            }
          >
            {t("requests.older")}
          </Button>
        ) : null}
      </nav>
    </main>
  );
}

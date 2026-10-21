import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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
import { getPortalSubmissions } from "@/fetchers/intake";
import { routes } from "@/lib/routes";

export const Route = createFileRoute("/requests")({
  component: PortalRequestsPage,
});

function PortalRequestsPage() {
  const { t } = useTranslation("portal");
  const query = useQuery({
    queryKey: ["portal", "submissions"],
    queryFn: () => getPortalSubmissions(),
  });

  const submissions = query.data?.submissions ?? [];

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 p-6">
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
          <Link to={routes.portalCatalogue.path}>
            <Button>
              {t("requests.newRequest", { defaultValue: "New request" })}
            </Button>
          </Link>
        </div>
      </header>

      {query.isError ? (
        <Alert variant="error">
          <AlertTitle>
            {t("error.title", { defaultValue: "Unable to load requests" })}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {query.error?.message || "Could not load your submissions."}
            </span>
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
                <Link to={routes.portalCatalogue.path}>
                  <Button variant="outline">
                    {t("requests.browseCatalogue", {
                      defaultValue: "Browse request catalogue",
                    })}
                  </Button>
                </Link>
              </div>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Request Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Submitted</TableHead>
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
                    <Badge variant="outline">{sub.state}</Badge>
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
    </main>
  );
}

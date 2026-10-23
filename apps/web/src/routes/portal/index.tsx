import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Button,
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

export const Route = createFileRoute("/")({ component: PortalHome });
function PortalHome() {
  const { t } = useTranslation("portal");
  const { portalUserId } = Route.useRouteContext();
  const query = useQuery({
    queryKey: ["portal", portalUserId, "recent-submissions"],
    queryFn: () => getPortalSubmissions({ limit: "5" }),
  });
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-lg">{t("home.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("home.description")}
          </p>
        </div>
        <Button render={<Link to={routes.portalCatalogue.path} />}>
          {t("requests.newRequest")}
        </Button>
      </header>
      <section
        className="flex flex-col gap-3"
        aria-labelledby="recent-requests"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="recent-requests" className="text-sm font-medium">
            {t("home.recent")}
          </h2>
          <Button
            variant="ghost"
            render={<Link to={routes.portalRequests.path} />}
          >
            {t("home.allRequests")}
          </Button>
        </div>
        {query.isError ? (
          <Alert variant="error">
            <AlertDescription>{t("requests.loadFailed")}</AlertDescription>
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("common:actions.retry")}
            </Button>
          </Alert>
        ) : query.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : query.data.submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("requests.emptyDescription")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("requests.reference")}</TableHead>
                <TableHead>{t("requests.type")}</TableHead>
                <TableHead>{t("requests.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.submissions.map((submission) => (
                <TableRow key={submission.ref}>
                  <TableCell>
                    <Link
                      to={routes.portalSubmission.path}
                      params={{ ref: submission.ref }}
                      className="hover:underline"
                    >
                      {submission.ref}
                    </Link>
                  </TableCell>
                  <TableCell>{submission.requestTypeName}</TableCell>
                  <TableCell>{submission.state}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </main>
  );
}

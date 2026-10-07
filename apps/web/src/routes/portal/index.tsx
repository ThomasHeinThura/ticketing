import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
  component: PortalHome,
});

function PortalHome() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="font-semibold text-3xl">
          {t("portal:intake.homeTitle", { defaultValue: "Customer portal" })}
        </h1>
        <p className="text-muted-foreground">
          {t("portal:intake.homeDescription", {
            defaultValue:
              "Submit a request, follow its progress, and reply to your service team.",
          })}
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Button render={<Link to="/catalogue" />}>
          {t("portal:intake.browseCatalogue", {
            defaultValue: "Browse request types",
          })}
        </Button>
        <Button variant="outline" render={<Link to="/approvals" />}>
          {t("portal:intake.viewApprovals", { defaultValue: "My approvals" })}
        </Button>
      </div>
    </main>
  );
}

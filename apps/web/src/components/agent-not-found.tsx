import { Link, useRouter } from "@tanstack/react-router";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@taskdesk/ui";
import { Compass } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { routes } from "@/lib/routes";

/**
 * UX-8: the agent app's branded not-found page, passed to the agent router as
 * `defaultNotFoundComponent` (main.tsx). TanStack renders it in place of the Outlet of the
 * deepest layout that matched the unknown address, so it shows inside the agent shell or the
 * settings shell rather than as the router's bare "Not Found" text. It never echoes the
 * requested address. Modelled on the portal's `PortalNotFoundPage`.
 */
export function AgentNotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <Empty data-testid="agent-not-found" className="min-h-[60vh]">
      <PageTitle title={t("portal:notFound.title")} />
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Compass />
        </EmptyMedia>
        <EmptyTitle>
          <h1 ref={headingRef} tabIndex={-1}>
            {t("portal:notFound.title")}
          </h1>
        </EmptyTitle>
        <EmptyDescription>{t("portal:notFound.description")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        <Button render={<Link to={routes.agentHome.path} />}>
          {t("navigation:sidebar.projects")}
        </Button>
        <Button variant="outline" onClick={() => router.history.back()}>
          {t("common:states.back")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@taskdesk/ui";
import { LifeBuoy, SearchIcon } from "lucide-react";
import { type FormEvent, lazy, Suspense, useState } from "react";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalCapabilities } from "@/lib/portal-capabilities";
import { routes } from "@/lib/routes";
import PortalNotificationBell from "./portal-notification-bell";
import PortalUserMenu, { type PortalShellUser } from "./portal-user-menu";

// Loads only once `GET /api/portal/projects` exists (S4c turns the capability on).
const PortalProjectSelector = lazy(() => import("./portal-project-selector"));

/**
 * The customer top bar (WSO2-style): project scope, search, Get help, theme, inbox and the
 * avatar menu. Search goes to the catalogue's own `?q=` filter until request search ships.
 */
export default function PortalTopbar({ user }: { user: PortalShellUser }) {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    void navigate({
      to: routes.portalCatalogue.path,
      search: q ? { q } : {},
    });
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {portalCapabilities.projects ? (
        <Suspense fallback={null}>
          <PortalProjectSelector />
        </Suspense>
      ) : null}
      <search
        aria-label={t("shell.search.label")}
        className="hidden min-w-0 max-w-md flex-1 sm:block"
      >
        <form onSubmit={search}>
          <InputGroup className="h-8">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("shell.search.placeholder")}
              aria-label={t("shell.search.label")}
            />
          </InputGroup>
        </form>
      </search>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label={t("shell.search.label")}
          render={<Link to={routes.portalCatalogue.path} />}
        >
          <SearchIcon className="size-4" aria-hidden="true" />
        </Button>
        <Button
          size="sm"
          className="max-sm:size-9 max-sm:px-0"
          render={<Link to={routes.portalCatalogue.path} />}
        >
          <LifeBuoy className="size-4" aria-hidden="true" />
          <span className="max-sm:sr-only">{t("shell.getHelp")}</span>
        </Button>
        <ThemeToggleDropdown label={t("shell.theme")} />
        <PortalNotificationBell />
        <PortalUserMenu user={user} />
      </div>
    </div>
  );
}

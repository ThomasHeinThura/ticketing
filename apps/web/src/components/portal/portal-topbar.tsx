import { Link } from "@tanstack/react-router";
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@taskdesk/ui";
import { LifeBuoy, SearchIcon } from "lucide-react";
import { type FormEvent, lazy, Suspense, useRef, useState } from "react";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { portalCapabilities } from "@/lib/portal-capabilities";
import { routes } from "@/lib/routes";
import PortalNotificationBell from "./portal-notification-bell";
import PortalUserMenu, { type PortalShellUser } from "./portal-user-menu";

// Loads only once `GET /api/portal/projects` exists (S4c turns the capability on).
const PortalProjectSelector = lazy(() => import("./portal-project-selector"));
// The help results load on first use (G11 portal budget).
const PortalSearchDialog = lazy(() => import("./portal-search-dialog"));

/**
 * The customer top bar (WSO2-style): project scope, search, Get help, theme, inbox and the
 * avatar menu. Search opens the combined help results: articles, request types and the
 * customer's own requests.
 */
export default function PortalTopbar({ user }: { user: PortalShellUser }) {
  const { t } = usePortalTranslation("portal");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Opened once: keeps the dialog mounted so it can animate closed and restore focus.
  const [searchUsed, setSearchUsed] = useState(false);
  const searchFrom = useRef<HTMLElement | null>(null);

  function openSearch(from: HTMLElement | null) {
    searchFrom.current = from;
    setSearchUsed(true);
    setSearchOpen(true);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSearch(
      event.currentTarget.querySelector<HTMLInputElement>("input[type=search]"),
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
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
          aria-haspopup="dialog"
          onClick={(event) => openSearch(event.currentTarget)}
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
      {searchUsed ? (
        <Suspense fallback={null}>
          <PortalSearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            initialQuery={query.trim()}
            returnFocusRef={searchFrom}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

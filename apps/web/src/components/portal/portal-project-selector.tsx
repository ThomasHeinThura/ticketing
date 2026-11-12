import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { ChevronDown, FolderKanban } from "lucide-react";
import { useEffect } from "react";
import {
  getPortalProjects,
  portalProjectKeys,
} from "@/fetchers/portal/projects";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { routes } from "@/lib/portal-route-builders";
import { parsePortalProjectSearch } from "@/lib/portal-route-search";

const ALL_PROJECTS = "";
/** `routes.portalProject.path` (`/projects/$projectKey`) as a pathname match. */
const PROJECT_DETAILS = /^\/projects\/([^/]+)\/?$/u;

function projectDetailsKey(pathname: string) {
  const match = PROJECT_DETAILS.exec(pathname);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Top-bar project scope (`?project=KEY`, registered in `routes.ts`). Rendered only while `portalCapabilities.projects` is
 * on; it hides itself when the organisation has fewer than two projects, since there is
 * nothing to choose.
 *
 * On Project Details (U-11) the page's own project is the scope: choosing another project opens
 * that project's details, and "All projects" returns to the organisation's Dashboard. Anywhere
 * else the current screen stays and is filtered (the Dashboard's figures and cases included).
 */
export default function PortalProjectSelector() {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const search = useLocation({ select: (location) => location.search });
  const pathname = useLocation({ select: (location) => location.pathname });
  const detailKey = projectDetailsKey(pathname);
  const selected =
    detailKey ?? parsePortalProjectSearch(search).project ?? ALL_PROJECTS;
  const projects = useQuery({
    queryKey: portalProjectKeys.list(),
    queryFn: getPortalProjects,
    retry: false,
    staleTime: 60_000,
  });
  const options = projects.data?.data ?? [];
  // A `?project=` key the organisation does not have (mistyped, foreign or removed) would blank
  // every scoped screen: once the list has loaded, drop it. Never while loading or after an error.
  const scoped = parsePortalProjectSearch(search).project;
  const unknownScope =
    scoped !== undefined &&
    projects.isSuccess &&
    !projects.data.data.some((project) => project.key === scoped);
  useEffect(() => {
    if (!unknownScope) return;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        project: undefined,
      }),
      replace: true,
    });
  }, [unknownScope, navigate]);
  if (options.length < 2) return null;
  const current = options.find((project) => project.key === selected);

  // Every signed-in portal route registers `project` and keeps it across navigation
  // (`portalProjectSearchMiddlewares`); naming it `undefined` clears the scope.
  function choose(project: string) {
    if (detailKey !== undefined) {
      if (project === detailKey) return;
      void (project
        ? navigate({
            to: routes.portalProject.path,
            params: { projectKey: project },
            search: { project },
          })
        : navigate({
            to: routes.portalHome.path,
            search: { project: undefined },
          }));
      return;
    }
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        project: project || undefined,
      }),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="max-w-48 justify-between gap-1.5"
            aria-label={t("shell.projectSelector.label")}
          />
        }
      >
        <FolderKanban className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {current?.name ?? t("shell.projectSelector.all")}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 opacity-70"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("shell.projectSelector.label")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={selected} onValueChange={choose}>
          <DropdownMenuRadioItem value={ALL_PROJECTS} closeOnClick>
            {t("shell.projectSelector.all")}
          </DropdownMenuRadioItem>
          {options.map((project) => (
            <DropdownMenuRadioItem
              key={project.key}
              value={project.key}
              closeOnClick
            >
              <span className="truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
import { getPortalProjects } from "@/fetchers/portal/projects";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { parsePortalProjectSearch } from "@/lib/routes";

const ALL_PROJECTS = "";

/**
 * Top-bar project scope (`?project=KEY`, registered in `routes.ts`). Rendered only while `portalCapabilities.projects` is
 * on; it hides itself when the organisation has fewer than two projects, since there is
 * nothing to choose.
 */
export default function PortalProjectSelector() {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const search = useLocation({ select: (location) => location.search });
  const selected = parsePortalProjectSearch(search).project ?? ALL_PROJECTS;
  const projects = useQuery({
    queryKey: ["portal", "projects", "selector"],
    queryFn: getPortalProjects,
    retry: false,
    staleTime: 60_000,
  });
  const options = projects.data?.data ?? [];
  if (options.length < 2) return null;
  const current = options.find((project) => project.key === selected);

  // Every signed-in portal route registers `project` and keeps it across navigation
  // (`portalProjectSearchMiddlewares`); naming it `undefined` clears the scope.
  function choose(project: string) {
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

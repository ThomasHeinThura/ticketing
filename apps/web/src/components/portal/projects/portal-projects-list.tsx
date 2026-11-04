import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@taskdesk/ui";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import {
  getPortalProjects,
  type PortalProjectOption,
  portalProjectKeys,
} from "@/fetchers/portal/projects";
import { usePortalTranslation } from "@/lib/i18n/portal-translation";
import { type PortalProjectsSearch, routes } from "@/lib/routes";
import {
  PortalProjectHealthBadge,
  PortalProjectStatusBadge,
} from "./portal-project-format";

type Tab = "all" | "projects" | "services";

function matchesTab(project: PortalProjectOption, tab: Tab) {
  if (tab === "projects") return project.kind === "project";
  if (tab === "services") return project.kind === "managed_service";
  return true;
}

function matchesQuery(project: PortalProjectOption, query: string) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return (
    project.key.toLocaleLowerCase().includes(needle) ||
    project.name.toLocaleLowerCase().includes(needle)
  );
}

/**
 * The organisation's projects and managed services (S4c, WSO2 "Projects" table): tabs by type,
 * a key/name search, and per-project action-required and outstanding counts. Tab and search are
 * URL state (`?tab=`, `?q=`), so the view survives reload, Back and a shared link.
 */
export function PortalProjectsList({
  search,
}: {
  search: PortalProjectsSearch;
}) {
  const { t } = usePortalTranslation("portal");
  const navigate = useNavigate();
  const tab: Tab = search.tab ?? "all";
  const [draft, setDraft] = useState({ from: search.q, value: search.q ?? "" });
  const query = draft.from === search.q ? draft.value : (search.q ?? "");
  const projects = useQuery({
    queryKey: portalProjectKeys.list(),
    queryFn: getPortalProjects,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
  const all = projects.data?.data ?? [];
  const visible = all.filter(
    (project) =>
      matchesTab(project, tab) && matchesQuery(project, query.trim()),
  );

  function update(next: { tab?: Tab; q?: string }) {
    const nextTab = next.tab ?? tab;
    const nextQ = (next.q ?? query).trim();
    void navigate({
      to: routes.portalProjects.path,
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        tab: nextTab === "all" ? undefined : nextTab,
        q: nextQ || undefined,
      }),
      replace: true,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <h1 className="font-semibold text-2xl">{t("projects.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("projects.description")}
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          onValueChange={(value) => update({ tab: value as Tab })}
        >
          <TabsList
            aria-label={t("projects.tabs.label")}
            className="w-max max-w-full overflow-x-auto"
          >
            <TabsTrigger value="all">{t("projects.tabs.all")}</TabsTrigger>
            <TabsTrigger value="services">
              {t("projects.tabs.services")}
            </TabsTrigger>
            <TabsTrigger value="projects">
              {t("projects.tabs.projects")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <InputGroup className="h-8 sm:max-w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            size="sm"
            value={query}
            onChange={(event) => {
              setDraft({ from: search.q, value: event.target.value });
              update({ q: event.target.value });
            }}
            placeholder={t("projects.search.placeholder")}
            aria-label={t("projects.search.label")}
          />
        </InputGroup>
      </div>

      {projects.isError ? (
        <Alert variant="error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("projects.loadFailed")}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void projects.refetch()}
            >
              {t("common:actions.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : projects.isLoading ? (
        <Card>
          <CardContent
            className="flex flex-col gap-3 p-4"
            role="status"
            aria-label={t("projects.title")}
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {all.length === 0
                    ? t("projects.empty.title")
                    : t("projects.noMatches.title")}
                </EmptyTitle>
                <EmptyDescription>
                  {all.length === 0
                    ? t("projects.empty.description")
                    : t("projects.noMatches.description")}
                </EmptyDescription>
              </EmptyHeader>
              {query ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft({ from: search.q, value: "" });
                    update({ q: "" });
                  }}
                >
                  {t("projects.search.clear")}
                </Button>
              ) : null}
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">
                  {t("projects.columns.key")}
                </TableHead>
                <TableHead>{t("projects.columns.name")}</TableHead>
                <TableHead className="w-36">
                  {t("projects.columns.type")}
                </TableHead>
                <TableHead className="w-40">
                  {t("projects.columns.status")}
                </TableHead>
                <TableHead className="w-32 text-right">
                  {t("projects.columns.actionRequired")}
                </TableHead>
                <TableHead className="w-28 text-right">
                  {t("projects.columns.outstanding")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((project) => (
                <TableRow key={project.key}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {project.key}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to={routes.portalProject.path}
                      params={{ projectKey: project.key }}
                      className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t(`projects.kind.${project.kind}`)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <PortalProjectStatusBadge status={project.status} />
                      <PortalProjectHealthBadge health={project.health} />
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.counts.actionRequired > 0 ? (
                      <Badge variant="warning">
                        {project.counts.actionRequired}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {project.counts.outstanding}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

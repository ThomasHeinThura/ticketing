import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { client } from "@taskdesk/libs";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import WorkItemSidePane from "@/components/work-item/work-item-side-pane";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaceMembers from "@/hooks/queries/workspace-users/use-get-workspace-users";
import {
  type AgentGlobalSearch,
  type AgentGlobalSearchScope,
  type AgentInboxFilter,
  type AgentMyWorkLens,
  type AgentMyWorkSearch,
  routes,
} from "@/lib/routes";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemRow } from "@/types/work-item";

function WorkspaceSettingsNav() {
  const items = [
    { label: "General", to: routes.workspaceSettings.path },
    { label: "Members", to: routes.workspaceMembers.path },
    { label: "States", to: routes.workspaceStates.path },
    { label: "Labels", to: routes.workspaceLabels.path },
    { label: "Canned responses", to: routes.workspaceCannedResponses.path },
    { label: "Service calendars", to: routes.serviceCalendars.path },
    { label: "SLA policies", to: routes.slaPolicies.path },
    { label: "Request types", to: routes.requestTypes.path },
    { label: "Danger zone", to: routes.workspaceDangerZone.path },
  ] as const;
  return (
    <nav
      aria-label="Workspace settings sections"
      className="flex flex-wrap gap-2"
    >
      {" "}
      {items.map((item) => (
        <Button
          key={item.to}
          variant="outline"
          size="sm"
          render={<Link to={item.to} />}
        >
          {" "}
          {item.label}{" "}
        </Button>
      ))}{" "}
    </nav>
  );
}
function ProfileSettingsNav() {
  const items = [
    { label: "General", to: routes.profileSettings.path },
    { label: "Appearance", to: routes.profileAppearance.path },
    { label: "Pending actions", to: routes.pendingActions.path },
  ] as const;
  return (
    <nav
      aria-label="Profile settings sections"
      className="flex flex-wrap gap-2"
    >
      {" "}
      {items.map((item) => (
        <Button
          key={item.to}
          variant="outline"
          size="sm"
          render={<Link to={item.to} />}
        >
          {" "}
          {item.label}{" "}
        </Button>
      ))}{" "}
    </nav>
  );
}
function ProjectSettingsNav({ projectKey }: { projectKey: string }) {
  const items = [
    { label: "General", to: routes.projectSettings.build({ projectKey }) },
    { label: "Members", to: routes.projectMembers.build({ projectKey }) },
    { label: "States", to: routes.projectStates.build({ projectKey }) },
    { label: "Labels", to: routes.projectLabels.build({ projectKey }) },
    {
      label: "Danger zone",
      to: routes.projectDangerZone.build({ projectKey }),
    },
  ] as const;
  return (
    <nav
      aria-label="Project settings sections"
      className="flex flex-wrap gap-2"
    >
      {" "}
      {items.map((item) => (
        <Button
          key={item.label}
          variant="outline"
          size="sm"
          render={<Link to={item.to as never} />}
        >
          {" "}
          {item.label}{" "}
        </Button>
      ))}{" "}
    </nav>
  );
}
export function AgentWorkspaceHomeScreen() {
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const { data: projects, isLoading: isProjectsLoading } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  if (isWorkspaceLoading || isProjectsLoading) {
    return (
      <main className="flex min-h-full w-full flex-col gap-5 p-6">
        {" "}
        <PageTitle title="Workspace home" /> <Skeleton className="h-8 w-56" />{" "}
        <Skeleton className="h-32 w-full" />{" "}
      </main>
    );
  }
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace home" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace home</h1>{" "}
        <p className="text-sm">
          {" "}
          {workspace?.name ?? "Active workspace"} — jump to your work, inbox,
          saved views, and active projects.{" "}
        </p>{" "}
      </header>{" "}
      <section aria-label="Quick destinations" className="flex flex-wrap gap-2">
        {" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.agentMyWork.path} />}
        >
          {" "}
          My work{" "}
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.agentInbox.path} />}
        >
          {" "}
          Inbox{" "}
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.agentSearch.path} />}
        >
          {" "}
          Global search{" "}
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.savedViews.path} />}
        >
          {" "}
          Saved views{" "}
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.intakeQueue.build()} />}
        >
          {" "}
          Intake triage{" "}
        </Button>{" "}
        <Button
          variant="outline"
          size="sm"
          render={<Link to={routes.workspaceSettings.path} />}
        >
          {" "}
          Workspace settings{" "}
        </Button>{" "}
      </section>{" "}
      <section aria-label="Projects" className="grid gap-4 md:grid-cols-2">
        {" "}
        {(projects ?? []).length === 0 ? (
          <Card>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle>No projects yet</CardTitle>{" "}
              <CardDescription>
                {" "}
                Create a project from the sidebar to start tracking work items.{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ) : (
          (projects ?? []).map((project) => (
            <Card key={project.id}>
              {" "}
              <CardHeader>
                {" "}
                <div className="flex items-center justify-between gap-2">
                  {" "}
                  <CardTitle className="text-base">{project.name}</CardTitle>{" "}
                  <Badge variant="outline">
                    {project.slug.toUpperCase()}
                  </Badge>{" "}
                </div>{" "}
                <CardDescription>
                  {" "}
                  {project.description || "Project workspace"}{" "}
                </CardDescription>{" "}
              </CardHeader>{" "}
              <CardContent className="flex flex-wrap gap-2">
                {" "}
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to={routes.projectOverview.path}
                      params={{ projectKey: project.slug }}
                    />
                  }
                >
                  {" "}
                  Overview{" "}
                </Button>{" "}
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to="/agent/projects/$projectKey/work"
                      params={{ projectKey: project.slug }}
                    />
                  }
                >
                  {" "}
                  Work items{" "}
                </Button>{" "}
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to={routes.projectBacklog.path}
                      params={{ projectKey: project.slug }}
                    />
                  }
                >
                  {" "}
                  Backlog{" "}
                </Button>{" "}
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      to={routes.projectSettings.path}
                      params={{ projectKey: project.slug }}
                    />
                  }
                >
                  {" "}
                  Settings{" "}
                </Button>{" "}
              </CardContent>{" "}
            </Card>
          ))
        )}{" "}
      </section>{" "}
    </main>
  );
}
export function AgentInboxScreen({
  filter,
  onFilterChange,
}: {
  filter: AgentInboxFilter;
  onFilterChange: (next: AgentInboxFilter) => void;
}) {
  const [items, setItems] = useState([
    {
      id: "notif-1",
      key: "HELP-7",
      title: "Customer cannot reset their password",
      summary: "Assigned to your queue in Help Desk",
      unread: true,
    },
  ]);
  const visibleItems =
    filter === "unread" ? items.filter((item) => item.unread) : items;
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Inbox" />{" "}
      <header className="flex flex-wrap items-center justify-between gap-3">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">Inbox</h1>{" "}
          <p className="text-sm">
            {" "}
            Notifications for assignments, mentions, and workflow updates.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          <Button
            type="button"
            size="sm"
            variant={filter === "all" ? "secondary" : "outline"}
            aria-pressed={filter === "all"}
            onClick={() => onFilterChange("all")}
          >
            {" "}
            All notifications{" "}
          </Button>{" "}
          <Button
            type="button"
            size="sm"
            variant={filter === "unread" ? "secondary" : "outline"}
            aria-pressed={filter === "unread"}
            onClick={() => onFilterChange("unread")}
          >
            {" "}
            Unread only{" "}
          </Button>{" "}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={items.every((item) => !item.unread)}
            onClick={() =>
              setItems((current) =>
                current.map((item) => ({ ...item, unread: false })),
              )
            }
          >
            {" "}
            Mark all read{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      {visibleItems.length === 0 ? (
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>Your inbox is clear</CardTitle>{" "}
            <CardDescription>
              {" "}
              No notifications match the current filter.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
        </Card>
      ) : (
        <section aria-label="Notifications" className="grid gap-3">
          {" "}
          {visibleItems.map((item) => (
            <Card key={item.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="space-y-1">
                  {" "}
                  <div className="flex items-center gap-2">
                    {" "}
                    <Badge variant="outline">{item.key}</Badge>{" "}
                    <Link
                      to={routes.workItemDetail.path}
                      params={{ key: item.key }}
                      className="font-medium text-sm hover:underline"
                    >
                      {" "}
                      {item.title}{" "}
                    </Link>{" "}
                    {item.unread ? <Badge>Unread</Badge> : null}{" "}
                  </div>{" "}
                  <p className="text-xs">{item.summary}</p>{" "}
                </div>{" "}
                {item.unread ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, unread: false }
                            : entry,
                        ),
                      )
                    }
                  >
                    {" "}
                    Mark read{" "}
                  </Button>
                ) : null}{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
        </section>
      )}{" "}
    </main>
  );
}
export function AgentMyWorkScreen({
  search,
  onUpdateSearch,
}: {
  search: AgentMyWorkSearch;
  onUpdateSearch: (next: Partial<AgentMyWorkSearch>) => void;
}) {
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const firstProject = projects?.[0];
  const lens: AgentMyWorkLens = search.lens ?? "assigned";
  const [approvals, setApprovals] = useState([
    {
      id: "appr-1",
      workItemKey: "HELP-1",
      title: "Production database firewall rule change",
      requester: "Alex Rivera",
      gate: "CAB Change Approval",
      state: "pending" as "pending" | "approved" | "rejected",
    },
    {
      id: "appr-2",
      workItemKey: "HELP-2",
      title: "Enterprise SSO production cutover",
      requester: "Samira Khan",
      gate: "Security Lead Sign-off",
      state: "pending" as "pending" | "approved" | "rejected",
    },
  ]);
  const workItemsQuery = useQuery({
    queryKey: ["my-work-items", firstProject?.id],
    queryFn: () => getWorkItems(firstProject?.id ?? "", "key", "asc"),
    enabled: Boolean(firstProject?.id),
  });
  const allItems: WorkItemRow[] = workItemsQuery.data?.items ?? [];
  const filteredItems = allItems.filter((item) => {
    if (
      search.q &&
      !`${item.key} ${item.title}`
        .toLowerCase()
        .includes(search.q.toLowerCase())
    ) {
      return false;
    }
    if (lens === "assigned" && user?.id && item.assigneeId) {
      return item.assigneeId === user.id;
    }
    return true;
  });
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={lens === "approvals" ? "Approvals inbox" : "My work"} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-3">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            {" "}
            {lens === "approvals" ? "Approvals inbox" : "My work"}{" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            {lens === "approvals"
              ? "Pending approval requests awaiting your decision."
              : "Work items assigned to you, created by you, or watched across projects."}{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          {(
            [
              ["assigned", "Assigned to me"],
              ["created", "Created by me"],
              ["watching", "Watching"],
              ["approvals", "Approvals inbox"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={lens === value ? "secondary" : "outline"}
              aria-pressed={lens === value}
              onClick={() =>
                onUpdateSearch({
                  lens: value === "assigned" ? undefined : value,
                })
              }
            >
              {" "}
              {label}{" "}
            </Button>
          ))}{" "}
        </div>{" "}
      </header>{" "}
      <div className="max-w-md">
        {" "}
        <Input
          aria-label="Filter my work"
          placeholder="Filter by key or title..."
          value={search.q ?? ""}
          onChange={(event) =>
            onUpdateSearch({ q: event.target.value || undefined })
          }
        />{" "}
      </div>{" "}
      {lens === "approvals" ? (
        <section
          aria-label="Approvals inbox"
          data-testid="agent-approvals-inbox"
          className="grid gap-3"
        >
          {" "}
          {approvals.map((approval) => (
            <Card key={approval.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="space-y-1">
                  {" "}
                  <div className="flex items-center gap-2">
                    {" "}
                    <Badge variant="outline">{approval.workItemKey}</Badge>{" "}
                    <span className="font-medium text-sm">
                      {approval.title}
                    </span>{" "}
                    <Badge variant="secondary">{approval.gate}</Badge>{" "}
                    <Badge variant="outline">{approval.state}</Badge>{" "}
                  </div>{" "}
                  <p className="text-xs">
                    {" "}
                    Requested by {approval.requester}{" "}
                  </p>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={approval.state !== "pending"}
                    onClick={() =>
                      setApprovals((prev) =>
                        prev.map((row) =>
                          row.id === approval.id
                            ? { ...row, state: "approved" }
                            : row,
                        ),
                      )
                    }
                  >
                    {" "}
                    Approve{" "}
                  </Button>{" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={approval.state !== "pending"}
                    onClick={() =>
                      setApprovals((prev) =>
                        prev.map((row) =>
                          row.id === approval.id
                            ? { ...row, state: "rejected" }
                            : row,
                        ),
                      )
                    }
                  >
                    {" "}
                    Reject{" "}
                  </Button>{" "}
                </div>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
        </section>
      ) : workItemsQuery.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : filteredItems.length === 0 ? (
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle>No matching work items</CardTitle>{" "}
            <CardDescription>
              {" "}
              No work items match the selected lens and filter.{" "}
            </CardDescription>{" "}
          </CardHeader>{" "}
        </Card>
      ) : (
        <section aria-label="My work items" className="grid gap-3">
          {" "}
          {filteredItems.map((item) => (
            <Card key={item.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="flex items-center gap-3">
                  {" "}
                  <Badge variant="outline">{item.key}</Badge>{" "}
                  <Link
                    to={routes.workItemDetail.path}
                    params={{ key: item.key }}
                    className="font-medium text-sm hover:underline"
                  >
                    {" "}
                    {item.title}{" "}
                  </Link>{" "}
                </div>{" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <Badge variant="secondary">{item.stateName}</Badge>{" "}
                  <Badge variant="outline">{item.priority}</Badge>{" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onUpdateSearch({ item: item.key })}
                  >
                    {" "}
                    Preview{" "}
                  </Button>{" "}
                </div>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
        </section>
      )}{" "}
      {search.item ? (
        <WorkItemSidePane
          itemKey={search.item}
          onClose={() => onUpdateSearch({ item: undefined })}
        />
      ) : null}{" "}
    </main>
  );
}
export function AgentGlobalSearchScreen({
  search,
  onUpdateSearch,
}: {
  search: AgentGlobalSearch;
  onUpdateSearch: (next: Partial<AgentGlobalSearch>) => void;
}) {
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const firstProject = projects?.[0];
  const scope: AgentGlobalSearchScope = search.scope ?? "all";
  const queryText = (search.q ?? "").toLowerCase();
  const workItemsQuery = useQuery({
    queryKey: ["global-search-work-items", firstProject?.id],
    queryFn: () => getWorkItems(firstProject?.id ?? "", "key", "asc"),
    enabled: Boolean(firstProject?.id),
  });
  const matchingProjects =
    scope === "work-items"
      ? []
      : (projects ?? []).filter((project) =>
          queryText
            ? `${project.name} ${project.slug}`
                .toLowerCase()
                .includes(queryText)
            : true,
        );
  const matchingWorkItems =
    scope === "projects"
      ? []
      : (workItemsQuery.data?.items ?? []).filter((item) =>
          queryText
            ? `${item.key} ${item.title}`.toLowerCase().includes(queryText)
            : true,
        );
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Global search" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Global search</h1>{" "}
        <p className="text-sm">
          {" "}
          Search work items and projects across your active workspace.{" "}
        </p>{" "}
      </header>{" "}
      <div className="flex flex-wrap items-center gap-3">
        {" "}
        <Input
          aria-label="Search workspace"
          placeholder="Search by key, title, or project..."
          className="max-w-md"
          value={search.q ?? ""}
          onChange={(event) =>
            onUpdateSearch({ q: event.target.value || undefined })
          }
        />{" "}
        <div className="flex flex-wrap gap-2">
          {" "}
          {(
            [
              ["all", "All results"],
              ["work-items", "Work items"],
              ["projects", "Projects"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={scope === value ? "secondary" : "outline"}
              aria-pressed={scope === value}
              onClick={() =>
                onUpdateSearch({ scope: value === "all" ? undefined : value })
              }
            >
              {" "}
              {label}{" "}
            </Button>
          ))}{" "}
        </div>{" "}
      </div>{" "}
      <section aria-label="Search results" className="grid gap-4">
        {" "}
        {matchingProjects.map((project) => (
          <Card key={`project-${project.id}`}>
            {" "}
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              {" "}
              <div className="flex items-center gap-2">
                {" "}
                <Badge variant="outline">Project</Badge>{" "}
                <Link
                  to={routes.projectOverview.path}
                  params={{ projectKey: project.slug }}
                  className="font-medium text-sm hover:underline"
                >
                  {" "}
                  {project.name}{" "}
                </Link>{" "}
              </div>{" "}
              <Badge variant="secondary">
                {project.slug.toUpperCase()}
              </Badge>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
        {matchingWorkItems.map((item) => (
          <Card key={`item-${item.id}`}>
            {" "}
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              {" "}
              <div className="flex items-center gap-2">
                {" "}
                <Badge variant="outline">{item.key}</Badge>{" "}
                <Link
                  to={routes.workItemDetail.path}
                  params={{ key: item.key }}
                  className="font-medium text-sm hover:underline"
                >
                  {" "}
                  {item.title}{" "}
                </Link>{" "}
              </div>{" "}
              <Badge variant="secondary">{item.stateName}</Badge>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
        {matchingProjects.length === 0 && matchingWorkItems.length === 0 ? (
          <Card>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle>No results found</CardTitle>{" "}
              <CardDescription>
                {" "}
                Try another search term or broaden the selected scope.{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ) : null}{" "}
      </section>{" "}
    </main>
  );
}
export function ProjectOverviewScreen({ projectKey }: { projectKey: string }) {
  const { data: workspace } = useActiveWorkspace();
  const { data: projects, isLoading } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find(
    (entry) => entry.slug.toLowerCase() === projectKey.toLowerCase(),
  );
  if (isLoading) {
    return (
      <main className="flex min-h-full w-full flex-col gap-5 p-6">
        {" "}
        <PageTitle title="Project overview" /> <Skeleton className="h-8 w-56" />{" "}
        <Skeleton className="h-32 w-full" />{" "}
      </main>
    );
  }
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title={`${project?.name ?? projectKey} — Overview`} />{" "}
      <header className="flex flex-wrap items-center justify-between gap-3">
        {" "}
        <div className="space-y-1">
          {" "}
          <div className="flex items-center gap-2">
            {" "}
            <h1 className="text-2xl font-semibold">Project overview</h1>{" "}
            <Badge variant="outline">
              {" "}
              {(project?.slug ?? projectKey).toUpperCase()}{" "}
            </Badge>{" "}
          </div>{" "}
          <p className="text-sm">
            {" "}
            {project?.name ?? projectKey} —{""}{" "}
            {project?.description ||
              "Service desk and project work summary."}{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap gap-2">
          {" "}
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/agent/projects/$projectKey/work"
                params={{ projectKey }}
              />
            }
          >
            {" "}
            Work items{" "}
          </Button>{" "}
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to={routes.projectBacklog.path} params={{ projectKey }} />
            }
          >
            {" "}
            Backlog{" "}
          </Button>{" "}
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to={routes.projectSettings.path} params={{ projectKey }} />
            }
          >
            {" "}
            Project settings{" "}
          </Button>{" "}
        </div>{" "}
      </header>{" "}
      <div className="grid gap-4 md:grid-cols-3">
        {" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle className="text-base">Project key</CardTitle>{" "}
            <CardDescription>
              Identifier prefix for work items
            </CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <p className="font-mono text-lg font-semibold">
              {" "}
              {(project?.slug ?? projectKey).toUpperCase()}{" "}
            </p>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle className="text-base">Total items</CardTitle>{" "}
            <CardDescription>Tracked in this project</CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <p className="text-lg font-semibold">
              {" "}
              {project?.statistics?.totalTasks ?? 1}{" "}
            </p>{" "}
          </CardContent>{" "}
        </Card>{" "}
        <Card>
          {" "}
          <CardHeader>
            {" "}
            <CardTitle className="text-base">Completion</CardTitle>{" "}
            <CardDescription>Completed work ratio</CardDescription>{" "}
          </CardHeader>{" "}
          <CardContent>
            {" "}
            <p className="text-lg font-semibold">
              {" "}
              {project?.statistics?.completionPercentage ?? 0}%{" "}
            </p>{" "}
          </CardContent>{" "}
        </Card>{" "}
      </div>{" "}
    </main>
  );
}
export function ProfileGeneralSettingsScreen() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? "Ada Example");
  const [saved, setSaved] = useState(false);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Profile settings" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Profile settings</h1>{" "}
        <p className="text-sm">
          {" "}
          Manage your personal display name and account identity.{" "}
        </p>{" "}
      </header>{" "}
      <ProfileSettingsNav />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Personal information</CardTitle>{" "}
          <CardDescription>
            {" "}
            Displayed on work items, comments, and activity entries.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2 max-w-md">
            {" "}
            <Label htmlFor="profile-display-name">Display name</Label>{" "}
            <Input
              id="profile-display-name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="space-y-2 max-w-md">
            {" "}
            <Label htmlFor="profile-email">Email address</Label>{" "}
            <Input
              id="profile-email"
              value={user?.email ?? "ada@example.test"}
              disabled
            />{" "}
          </div>{" "}
          <div className="flex items-center gap-3">
            {" "}
            <Button type="button" size="sm" onClick={() => setSaved(true)}>
              {" "}
              Save profile{" "}
            </Button>{" "}
            {saved ? <Badge variant="secondary">Saved</Badge> : null}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function ProfileAppearanceSettingsScreen() {
  const { theme, setTheme } = useUserPreferencesStore();
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Appearance" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Appearance</h1>{" "}
        <p className="text-sm">
          Choose how TaskDesk looks on this device.
        </p>{" "}
      </header>{" "}
      <ProfileSettingsNav />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Theme preference</CardTitle>{" "}
          <CardDescription>
            {" "}
            Select light, dark, or system colour mode.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-wrap gap-2">
          {" "}
          {(
            [
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ] as const
          ).map(([mode, label]) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={theme === mode ? "secondary" : "outline"}
              aria-pressed={theme === mode}
              onClick={() => setTheme(mode)}
            >
              {" "}
              {label}{" "}
            </Button>
          ))}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function WorkspaceGeneralSettingsScreen() {
  const { data: workspace } = useActiveWorkspace();
  const [name, setName] = useState(workspace?.name ?? "Northstar Support");
  const [description, setDescription] = useState(
    workspace?.description ?? "Primary service desk workspace",
  );
  const [saved, setSaved] = useState(false);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace settings" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace settings</h1>{" "}
        <p className="text-sm">
          {" "}
          Configure workspace identity, members, states, labels, and templates.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>General details</CardTitle>{" "}
          <CardDescription>
            {" "}
            Workspace name and summary shown across projects.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-2 max-w-md">
            {" "}
            <Label htmlFor="workspace-name-input">Workspace name</Label>{" "}
            <Input
              id="workspace-name-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="space-y-2 max-w-md">
            {" "}
            <Label htmlFor="workspace-description-input">Description</Label>{" "}
            <Input
              id="workspace-description-input"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="flex items-center gap-3">
            {" "}
            <Button type="button" size="sm" onClick={() => setSaved(true)}>
              {" "}
              Save workspace settings{" "}
            </Button>{" "}
            {saved ? <Badge variant="secondary">Saved</Badge> : null}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function WorkspaceMembersSettingsScreen({
  query,
  onQueryChange,
}: {
  query?: string;
  onQueryChange: (next?: string) => void;
}) {
  const { data: workspace } = useActiveWorkspace();
  const { data: members } = useGetWorkspaceMembers({
    workspaceId: workspace?.id ?? "",
  });
  const filtered = (members ?? []).filter((member) =>
    query
      ? `${member.name ?? ""} ${member.email ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : true,
  );
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace members" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace members</h1>{" "}
        <p className="text-sm">
          {" "}
          People with access to this workspace and their assigned roles.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <div className="max-w-md">
        {" "}
        <Input
          aria-label="Filter workspace members"
          placeholder="Filter members by name or email..."
          value={query ?? ""}
          onChange={(event) => onQueryChange(event.target.value || undefined)}
        />{" "}
      </div>{" "}
      <section aria-label="Members list" className="grid gap-3">
        {" "}
        {filtered.length === 0 ? (
          <Card>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle>No matching members</CardTitle>{" "}
              <CardDescription>
                {" "}
                No workspace members match the current filter.{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ) : (
          filtered.map((member) => (
            <Card key={member.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="space-y-0.5">
                  {" "}
                  <p className="font-medium text-sm">
                    {" "}
                    {member.name || member.email}{" "}
                  </p>{" "}
                  <p className="text-xs">{member.email}</p>{" "}
                </div>{" "}
                <Badge variant="outline">{member.role ?? "member"}</Badge>{" "}
              </CardContent>{" "}
            </Card>
          ))
        )}{" "}
      </section>{" "}
    </main>
  );
}
export function WorkspaceStatesSettingsScreen() {
  const categories = [
    {
      name: "Backlog",
      group: "backlog",
      description: "Captured and awaiting triage or scheduling.",
    },
    {
      name: "Todo",
      group: "unstarted",
      description: "Scheduled and ready to start.",
    },
    {
      name: "In progress",
      group: "started",
      description: "Actively being worked on.",
    },
    { name: "Done", group: "completed", description: "Resolved and verified." },
    {
      name: "Cancelled",
      group: "cancelled",
      description: "Closed without implementation.",
    },
  ] as const;
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace states" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace states</h1>{" "}
        <p className="text-sm">
          {" "}
          Canonical state templates and status categories shared across
          projects.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <section aria-label="State templates" className="grid gap-3">
        {" "}
        {categories.map((state) => (
          <Card key={state.group}>
            {" "}
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              {" "}
              <div className="space-y-0.5">
                {" "}
                <p className="font-medium text-sm">{state.name}</p>{" "}
                <p className="text-xs">{state.description}</p>{" "}
              </div>{" "}
              <Badge variant="outline">{state.group}</Badge>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
      </section>{" "}
    </main>
  );
}
export function WorkspaceLabelsSettingsScreen() {
  const [labels, setLabels] = useState([
    { id: "lbl-incident", name: "incident", category: "Service desk" },
    { id: "lbl-security", name: "security", category: "Governance" },
  ]);
  const [newLabelName, setNewLabelName] = useState("");
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace labels" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace labels</h1>{" "}
        <p className="text-sm">
          {" "}
          Shared labels available across all projects in this workspace.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-base">Create label</CardTitle>{" "}
          <CardDescription>
            {" "}
            Add a reusable label for categorizing work items.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-wrap items-end gap-2">
          {" "}
          <div className="space-y-1">
            {" "}
            <Label htmlFor="new-workspace-label">Label name</Label>{" "}
            <Input
              id="new-workspace-label"
              placeholder="e.g. billing"
              value={newLabelName}
              onChange={(event) => setNewLabelName(event.target.value)}
            />{" "}
          </div>{" "}
          <Button
            type="button"
            size="sm"
            disabled={!newLabelName.trim()}
            onClick={() => {
              const trimmed = newLabelName.trim();
              if (!trimmed) return;
              setLabels((current) => [
                ...current,
                {
                  id: `lbl-${trimmed.toLowerCase()}`,
                  name: trimmed,
                  category: "Workspace",
                },
              ]);
              setNewLabelName("");
            }}
          >
            {" "}
            Add label{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <section aria-label="Workspace labels list" className="grid gap-3">
        {" "}
        {labels.map((label) => (
          <Card key={label.id}>
            {" "}
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              {" "}
              <Badge variant="outline">{label.name}</Badge>{" "}
              <span className="text-xs">{label.category}</span>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
      </section>{" "}
    </main>
  );
}
export function WorkspaceCannedResponsesSettingsScreen({
  query,
  onQueryChange,
}: {
  query?: string;
  onQueryChange: (next?: string) => void;
}) {
  const [templates, setTemplates] = useState([
    {
      id: "cr-1",
      title: "Password reset instructions",
      body: "We have sent a fresh password reset link to your verified email address.",
    },
    {
      id: "cr-2",
      title: "Escalated to engineering",
      body: "Your request has been linked to an engineering work item for investigation.",
    },
  ]);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const visible = templates.filter((item) =>
    query
      ? `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase())
      : true,
  );
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Canned responses" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Canned responses</h1>{" "}
        <p className="text-sm">
          {" "}
          Reusable reply templates for common service desk conversations.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <div className="max-w-md">
        {" "}
        <Input
          aria-label="Filter canned responses"
          placeholder="Search canned responses..."
          value={query ?? ""}
          onChange={(event) => onQueryChange(event.target.value || undefined)}
        />{" "}
      </div>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-base">New canned response</CardTitle>{" "}
          <CardDescription>
            {" "}
            Create a standard reply agents can insert into comments.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-3">
          {" "}
          <div className="space-y-1 max-w-md">
            {" "}
            <Label htmlFor="canned-title">Template title</Label>{" "}
            <Input
              id="canned-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="e.g. Verification complete"
            />{" "}
          </div>{" "}
          <div className="space-y-1 max-w-xl">
            {" "}
            <Label htmlFor="canned-body">Response text</Label>{" "}
            <Input
              id="canned-body"
              value={newBody}
              onChange={(event) => setNewBody(event.target.value)}
              placeholder="Write the reusable message..."
            />{" "}
          </div>{" "}
          <Button
            type="button"
            size="sm"
            disabled={!newTitle.trim() || !newBody.trim()}
            onClick={() => {
              setTemplates((current) => [
                ...current,
                {
                  id: `cr-${current.length + 1}`,
                  title: newTitle.trim(),
                  body: newBody.trim(),
                },
              ]);
              setNewTitle("");
              setNewBody("");
            }}
          >
            {" "}
            Save canned response{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <section aria-label="Canned response templates" className="grid gap-3">
        {" "}
        {visible.map((item) => (
          <Card key={item.id}>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle className="text-base">{item.title}</CardTitle>{" "}
              <CardDescription>{item.body}</CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ))}{" "}
      </section>{" "}
    </main>
  );
}
export function WorkspaceDangerZoneSettingsScreen() {
  const { data: workspace } = useActiveWorkspace();
  const [confirmation, setConfirmation] = useState("");
  const slug = workspace?.slug ?? "northstar-support";
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Workspace danger zone" />{" "}
      <header className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">Workspace danger zone</h1>{" "}
        <p className="text-sm">
          {" "}
          Irreversible workspace lifecycle actions governed by pending-action
          approval.{" "}
        </p>{" "}
      </header>{" "}
      <WorkspaceSettingsNav />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Pending-action protection</CardTitle>{" "}
          <CardDescription>
            {" "}
            Deleting a workspace creates a pending action and schedules soft
            deletion with a 30-day retention window before purge.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Delete workspace</CardTitle>{" "}
          <CardDescription>
            {" "}
            Type {slug} to enable workspace deletion.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4 max-w-md">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="confirm-workspace-slug">
              {" "}
              Confirm workspace slug{" "}
            </Label>{" "}
            <Input
              id="confirm-workspace-slug"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={slug}
            />{" "}
          </div>{" "}
          <div className="flex flex-wrap gap-2">
            {" "}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={confirmation.trim() !== slug}
            >
              {" "}
              Request workspace deletion{" "}
            </Button>{" "}
            <Button
              variant="outline"
              size="sm"
              render={<Link to={routes.pendingActions.path} />}
            >
              {" "}
              View pending actions{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function ProjectGeneralSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find(
    (entry) => entry.slug.toLowerCase() === projectKey.toLowerCase(),
  );
  const [name, setName] = useState(project?.name ?? "Help Desk");
  const [description, setDescription] = useState(
    project?.description ?? "Customer support work",
  );
  const [saved, setSaved] = useState(false);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Project settings" />{" "}
      <header className="space-y-1">
        {" "}
        <div className="flex items-center gap-2">
          {" "}
          <h1 className="text-2xl font-semibold">Project settings</h1>{" "}
          <Badge variant="outline">{projectKey.toUpperCase()}</Badge>{" "}
        </div>{" "}
        <p className="text-sm">
          {" "}
          Configure project details, members, workflow states, and labels.{" "}
        </p>{" "}
      </header>{" "}
      <ProjectSettingsNav projectKey={projectKey} />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>General details</CardTitle>{" "}
          <CardDescription>
            {" "}
            Project name, key prefix, and description.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4 max-w-md">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="project-settings-name">Project name</Label>{" "}
            <Input
              id="project-settings-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="project-settings-key">Project key</Label>{" "}
            <Input
              id="project-settings-key"
              value={projectKey.toUpperCase()}
              disabled
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="project-settings-description">Description</Label>{" "}
            <Input
              id="project-settings-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setSaved(false);
              }}
            />{" "}
          </div>{" "}
          <div className="flex items-center gap-3">
            {" "}
            <Button type="button" size="sm" onClick={() => setSaved(true)}>
              {" "}
              Save project settings{" "}
            </Button>{" "}
            {saved ? <Badge variant="secondary">Saved</Badge> : null}{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function ProjectMembersSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const { data: workspace } = useActiveWorkspace();
  const { data: members } = useGetWorkspaceMembers({
    workspaceId: workspace?.id ?? "",
  });
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Project members" />{" "}
      <header className="space-y-1">
        {" "}
        <div className="flex items-center gap-2">
          {" "}
          <h1 className="text-2xl font-semibold">Project members</h1>{" "}
          <Badge variant="outline">{projectKey.toUpperCase()}</Badge>{" "}
        </div>{" "}
        <p className="text-sm">
          {" "}
          People with reach and role assignments in this project.{" "}
        </p>{" "}
      </header>{" "}
      <ProjectSettingsNav projectKey={projectKey} />{" "}
      <section aria-label="Project members list" className="grid gap-3">
        {" "}
        {(members ?? []).length === 0 ? (
          <Card>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle>No project members</CardTitle>{" "}
              <CardDescription>
                {" "}
                Grant project membership from workspace members.{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ) : (
          (members ?? []).map((member) => (
            <Card key={member.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="space-y-0.5">
                  {" "}
                  <p className="font-medium text-sm">
                    {" "}
                    {member.name || member.email}{" "}
                  </p>{" "}
                  <p className="text-xs">{member.email}</p>{" "}
                </div>{" "}
                <Badge variant="outline">{member.role ?? "lead"}</Badge>{" "}
              </CardContent>{" "}
            </Card>
          ))
        )}{" "}
      </section>{" "}
    </main>
  );
}
export function ProjectStatesSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find(
    (entry) => entry.slug.toLowerCase() === projectKey.toLowerCase(),
  );
  const statesQuery = useQuery({
    queryKey: ["project-states-settings", project?.id],
    queryFn: async () => {
      const response = await client.projects[":projectId"].states.$get({
        param: { projectId: project?.id ?? "" },
      });
      if (!response.ok) return [];
      return await response.json();
    },
    enabled: Boolean(project?.id),
  });
  const states = statesQuery.data ?? [];
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Project states" />{" "}
      <header className="space-y-1">
        {" "}
        <div className="flex items-center gap-2">
          {" "}
          <h1 className="text-2xl font-semibold">Project states</h1>{" "}
          <Badge variant="outline">{projectKey.toUpperCase()}</Badge>{" "}
        </div>{" "}
        <p className="text-sm">
          {" "}
          Workflow states enabled for work items in this project.{" "}
        </p>{" "}
      </header>{" "}
      <ProjectSettingsNav projectKey={projectKey} />{" "}
      <section aria-label="Project states list" className="grid gap-3">
        {" "}
        {states.length === 0 ? (
          <Card>
            {" "}
            <CardHeader>
              {" "}
              <CardTitle>Default workflow states active</CardTitle>{" "}
              <CardDescription>
                {" "}
                Backlog, In progress, and Done are configured for this project.{" "}
              </CardDescription>{" "}
            </CardHeader>{" "}
          </Card>
        ) : (
          states.map((state) => (
            <Card key={state.id}>
              {" "}
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                {" "}
                <div className="flex items-center gap-2">
                  {" "}
                  <span className="font-medium text-sm">{state.name}</span>{" "}
                  {state.isDefault ? (
                    <Badge variant="secondary">Default</Badge>
                  ) : null}{" "}
                </div>{" "}
                <Badge variant="outline">{state.group}</Badge>{" "}
              </CardContent>{" "}
            </Card>
          ))
        )}{" "}
      </section>{" "}
    </main>
  );
}
export function ProjectLabelsSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [labels, setLabels] = useState([
    { id: "proj-lbl-1", name: "bug", scope: projectKey.toUpperCase() },
    {
      id: "proj-lbl-2",
      name: "customer-reported",
      scope: projectKey.toUpperCase(),
    },
  ]);
  const [newName, setNewName] = useState("");
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Project labels" />{" "}
      <header className="space-y-1">
        {" "}
        <div className="flex items-center gap-2">
          {" "}
          <h1 className="text-2xl font-semibold">Project labels</h1>{" "}
          <Badge variant="outline">{projectKey.toUpperCase()}</Badge>{" "}
        </div>{" "}
        <p className="text-sm">
          {" "}
          Labels scoped to this project alongside inherited workspace labels.{" "}
        </p>{" "}
      </header>{" "}
      <ProjectSettingsNav projectKey={projectKey} />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-base">Add project label</CardTitle>{" "}
          <CardDescription>
            {" "}
            Create a label specific to {projectKey.toUpperCase()}.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="flex flex-wrap items-end gap-2">
          {" "}
          <div className="space-y-1">
            {" "}
            <Label htmlFor="new-project-label">Label name</Label>{" "}
            <Input
              id="new-project-label"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. regression"
            />{" "}
          </div>{" "}
          <Button
            type="button"
            size="sm"
            disabled={!newName.trim()}
            onClick={() => {
              const trimmed = newName.trim();
              if (!trimmed) return;
              setLabels((current) => [
                ...current,
                {
                  id: `proj-lbl-${current.length + 1}`,
                  name: trimmed,
                  scope: projectKey.toUpperCase(),
                },
              ]);
              setNewName("");
            }}
          >
            {" "}
            Create project label{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <section aria-label="Project labels list" className="grid gap-3">
        {" "}
        {labels.map((label) => (
          <Card key={label.id}>
            {" "}
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              {" "}
              <Badge variant="outline">{label.name}</Badge>{" "}
              <span className="text-xs">{label.scope}</span>{" "}
            </CardContent>{" "}
          </Card>
        ))}{" "}
      </section>{" "}
    </main>
  );
}
export function ProjectDangerZoneSettingsScreen({
  projectKey,
}: {
  projectKey: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const upperKey = projectKey.toUpperCase();
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="Project danger zone" />{" "}
      <header className="space-y-1">
        {" "}
        <div className="flex items-center gap-2">
          {" "}
          <h1 className="text-2xl font-semibold">Project danger zone</h1>{" "}
          <Badge variant="outline">{upperKey}</Badge>{" "}
        </div>{" "}
        <p className="text-sm">
          Archive or request deletion for this project.
        </p>{" "}
      </header>{" "}
      <ProjectSettingsNav projectKey={projectKey} />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Archive project</CardTitle>{" "}
          <CardDescription>
            {" "}
            Archiving freezes all work items, comments, and time entries in
            read-only mode.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <Button type="button" variant="outline" size="sm">
            {" "}
            Archive project{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Separator />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle>Delete project</CardTitle>{" "}
          <CardDescription>
            {" "}
            Type {upperKey} to request project deletion with a 30-day recovery
            window.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4 max-w-md">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="confirm-project-key">Confirm project key</Label>{" "}
            <Input
              id="confirm-project-key"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={upperKey}
            />{" "}
          </div>{" "}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={confirmation.trim().toUpperCase() !== upperKey}
          >
            {" "}
            Request project deletion{" "}
          </Button>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}

import type { ResolvedIdentity } from "@taskdesk/permissions";
import { projectsWithFeature } from "../../feature-flag/repository";
import { searchArticles } from "../../kb/repository";
import { kbEnabledWorkspaceIds } from "../../kb/visibility";
import { searchProjectPages } from "../../pages/search";
import { isCustomerPrincipal } from "../../utils/is-customer-principal";
import {
  type CanonicalWorkItemRow,
  searchCanonicalWorkItems,
  searchCanonicalWorkItemsFuzzy,
  searchSavedViews,
  searchWorkspacePeople,
} from "../canonical-repository";
import {
  findTasksByShortId,
  listUserWorkspaceIds,
  type SearchScope,
  searchActivities,
  searchProjects,
  searchTasks,
  searchWorkspaces,
} from "../repository";
import { TASK_SHORT_ID_PATTERN } from "../task-short-id";

type SearchParams = {
  query: string;
  identity: ResolvedIdentity;
  /** Aborted when the HTTP client leaves; checkpoints stop later entity/fallback work. */
  signal?: AbortSignal;
  type?:
    | "all"
    | "tasks"
    | "work_items"
    | "people"
    | "views"
    | "pages"
    | "kb_articles"
    | "projects"
    | "workspaces"
    | "comments"
    | "activities";
  workspaceId?: string;
  projectId?: string;
  limit?: number;
  /**
   * Resolves which of the given workspaces' live projects the caller reaches (#740). Every
   * task, project, comment and activity hit is restricted to that set IN SQL, so the page,
   * the ranking and `totalCount` can never be built from a hidden project's rows.
   */
  reachableProjectIds: (workspaceIds: string[]) => Promise<string[]>;
  /**
   * The caller's `work_item:read` reach in one workspace, as `resolveWorkItemSearchAccess`
   * decides it for structured work item search. `null` when the caller has no person row or
   * no work item read access, in which case no work item or saved view is returned.
   */
  workItemAccess?: (
    workspaceId: string,
  ) => Promise<{ personId: string; projectIds: string[] } | null>;
  /** A live KB read-capability check, including API-key scope. */
  kbArticleAccess?: (workspaceId: string) => Promise<boolean>;
};

type SearchResult = {
  id: string;
  type:
    | "task"
    | "work_item"
    | "person"
    | "saved_view"
    | "page"
    | "kb_article"
    | "project"
    | "workspace"
    | "comment"
    | "activity";
  title: string;
  key?: string;
  layout?: string;
  description?: string;
  content?: string;
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  userId?: string;
  userName?: string;
  createdAt: Date;
  relevanceScore: number;
  taskNumber?: number;
  version?: number;
  projectSlug?: string;
  priority?: string;
  status?: string;
};

function toDisplayCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getActivitySearchContent(
  type: string,
  content: string | null,
  eventData: unknown,
) {
  if (content) return content;
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return undefined;
  }

  const data = eventData as Record<string, unknown>;

  switch (type) {
    case "status_changed":
      return `changed status from ${toDisplayCase(String(data.oldStatus ?? ""))} to ${toDisplayCase(String(data.newStatus ?? ""))}`;
    case "priority_changed":
      return `changed priority from ${toDisplayCase(String(data.oldPriority ?? ""))} to ${toDisplayCase(String(data.newPriority ?? ""))}`;
    case "unassigned":
      return "unassigned the task";
    case "assignee_changed":
      return data.isSelfAssigned
        ? "assigned the task to themselves"
        : `assigned the task to ${String(data.newAssignee ?? "someone")}`;
    case "due_date_changed":
      if (!data.newDueDate) {
        return "cleared the due date";
      }
      if (!data.oldDueDate) {
        return `set due date to ${String(data.newDueDate)}`;
      }
      return `changed due date from ${String(data.oldDueDate)} to ${String(data.newDueDate)}`;
    case "title_changed":
      return `changed title from "${String(data.oldTitle ?? "")}" to "${String(data.newTitle ?? "")}"`;
    case "task":
      return "created the task";
    default:
      return undefined;
  }
}

async function globalSearch(params: SearchParams): Promise<{
  results: SearchResult[];
  totalCount: number;
  searchQuery: string;
}> {
  const {
    query,
    identity,
    signal,
    type = "all",
    workspaceId,
    projectId,
    limit = 20,
    reachableProjectIds,
    workItemAccess,
    kbArticleAccess,
  } = params;

  const aborted = () => signal?.aborted === true;
  const emptyResult = () => ({
    results: [],
    totalCount: 0,
    searchQuery: query,
  });
  if (aborted()) return emptyResult();

  const resolvedUserId = identity.userId;
  if (!resolvedUserId) {
    return { results: [], totalCount: 0, searchQuery: query };
  }

  const userWorkspaces = await listUserWorkspaceIds(resolvedUserId);
  if (aborted()) return emptyResult();

  const accessibleWorkspaceIds = userWorkspaces
    .map((w) => w.workspaceId)
    .filter(Boolean);

  if (accessibleWorkspaceIds.length === 0) {
    return { results: [], totalCount: 0, searchQuery: query };
  }

  const results: SearchResult[] = [];
  const searchPattern = `%${query.toLowerCase()}%`;

  // #187: every result below (short-id tasks, the general task/comment/activity
  // search, and project search itself) joins through `projectTable` and reuses this
  // filter, so excluding a soft-deleted project's rows here closes all four at once --
  // matching `get-project.ts`'s "gone everywhere in ordinary use" convention.
  // #740: the same filter also restricts to the projects the caller REACHES (workspace
  // membership alone is not reach), so a hit never names a project the caller cannot see.
  const reachable = await reachableProjectIds(
    workspaceId ? [workspaceId] : accessibleWorkspaceIds,
  );
  if (aborted()) return emptyResult();
  const scope: SearchScope = {
    identity,
    workspaceId,
    accessibleWorkspaceIds,
    reachableProjectIds: reachable,
  };

  // Check if query matches short-id pattern (e.g. "DEP-23"). `generateProjectSlug`
  // normalizes to NFKC before it stores a key, so the query is normalized too,
  // or a decomposed "ПА-23" would never reach the stored composed form.
  const shortIdMatch = query.normalize("NFKC").match(TASK_SHORT_ID_PATTERN);

  // P1-21 (SV-1/SV-3): the legacy task search runs only under an explicit type=tasks, so
  // type=all returns canonical kinds and legacy hits cannot push work items off the page.
  if (type === "tasks") {
    const seenTaskIds = new Set<string>();

    // If query matches short-id pattern, look up by project slug + task number first
    if (shortIdMatch?.[1] && shortIdMatch[2]) {
      const slug = shortIdMatch[1];
      const numberStr = shortIdMatch[2];
      const taskNumber = Number.parseInt(numberStr, 10);

      const shortIdTasks = await findTasksByShortId({
        scope,
        projectId,
        slug,
        taskNumber,
      });
      if (aborted()) return emptyResult();

      for (const task of shortIdTasks) {
        seenTaskIds.add(task.id);
        results.push({
          id: task.id,
          type: "task",
          title: task.title,
          description: task.description || undefined,
          projectId: task.projectId,
          projectName: task.projectName || undefined,
          projectSlug: task.projectSlug || undefined,
          workspaceId: task.workspaceId || undefined,
          workspaceName: task.workspaceName || undefined,
          userId: task.userId || undefined,
          userName: task.userName || undefined,
          createdAt: task.createdAt,
          relevanceScore: 10, // Highest relevance for exact short-id match
          taskNumber: task.taskNumber || undefined,
          version: task.version,
          priority: task.priority || undefined,
          status: task.status,
        });
      }
    }

    // Also run text search for tasks
    const tasks = await searchTasks({
      scope,
      projectId,
      searchPattern,
      limit,
    });
    if (aborted()) return emptyResult();

    for (const task of tasks) {
      if (seenTaskIds.has(task.id)) continue;
      results.push({
        id: task.id,
        type: "task",
        title: task.title,
        description: task.description || undefined,
        projectId: task.projectId,
        projectName: task.projectName || undefined,
        projectSlug: task.projectSlug || undefined,
        workspaceId: task.workspaceId || undefined,
        workspaceName: task.workspaceName || undefined,
        userId: task.userId || undefined,
        userName: task.userName || undefined,
        createdAt: task.createdAt,
        relevanceScore: task.relevanceScore,
        taskNumber: task.taskNumber || undefined,
        version: task.version,
        priority: task.priority || undefined,
        status: task.status,
      });
    }
  }

  // Canonical branches (SV-1). Work items, people and saved views are agent-side surfaces: a
  // customer-side caller (portal identity) gets none of them from this route.
  const wantsCanonical =
    type === "all" ||
    type === "work_items" ||
    type === "people" ||
    type === "views" ||
    type === "pages" ||
    type === "kb_articles";
  const searchWorkspaceId =
    workspaceId ??
    (accessibleWorkspaceIds.length === 1
      ? accessibleWorkspaceIds[0]
      : undefined);
  const isCustomer =
    wantsCanonical && searchWorkspaceId
      ? await isCustomerPrincipal(resolvedUserId, searchWorkspaceId)
      : false;
  if (aborted()) return emptyResult();
  let peopleResultsPromise: Promise<SearchResult[]> = Promise.resolve([]);
  let pageResultsPromise: Promise<SearchResult[]> = Promise.resolve([]);
  let viewResultsPromise: Promise<SearchResult[]> = Promise.resolve([]);
  let articleResultsPromise: Promise<SearchResult[]> = Promise.resolve([]);
  if (wantsCanonical && searchWorkspaceId && !isCustomer) {
    const term = query.normalize("NFKC").trim();
    const access =
      type === "all" || type === "work_items" || type === "views"
        ? ((await workItemAccess?.(searchWorkspaceId)) ?? null)
        : null;
    if (aborted()) return emptyResult();
    // Intersect with the legacy reach set so a project outside either decision never appears.
    const reachableSet = new Set(reachable);
    const itemProjectIds = (access?.projectIds ?? []).filter((id) =>
      reachableSet.has(id),
    );

    if ((type === "all" || type === "work_items") && access && term) {
      const base = {
        workspaceId: searchWorkspaceId,
        reachableProjectIds: itemProjectIds,
        projectId,
        term,
      };
      let rows: CanonicalWorkItemRow[] = await searchCanonicalWorkItems({
        ...base,
        limit,
      });
      // A query can be canceled while Postgres is running. We cannot cancel that SQL
      // statement here, but we can avoid starting the expensive fuzzy fallback or any
      // remaining entity lookups for an obsolete prefix.
      if (aborted()) return emptyResult();
      // SV-9 is a typo fallback, not a way to pad a good prefix/title match with
      // near-duplicates. On a common prefix, pg_trgm can legitimately match most
      // of a large workspace; asking it to rank those rows after every partial hit
      // turns ordinary typing into a full sort of the workspace's work items.
      if (rows.length === 0) {
        rows = rows.concat(
          await searchCanonicalWorkItemsFuzzy({
            ...base,
            excludeIds: rows.map((row) => row.id),
            limit: limit - rows.length,
          }),
        );
        if (aborted()) return emptyResult();
      }
      for (const item of rows) {
        results.push({
          id: item.id,
          type: "work_item",
          key: item.key,
          title: item.title,
          description: item.stateName,
          projectId: item.projectId,
          projectName: item.projectName,
          projectSlug: item.projectSlug,
          workspaceId: item.workspaceId,
          workspaceName: item.workspaceName || undefined,
          createdAt: item.createdAt,
          relevanceScore: item.relevanceScore,
          taskNumber: item.number,
          priority: item.priority || undefined,
          status: item.stateName,
        });
      }
    }

    if ((type === "all" || type === "people") && term) {
      peopleResultsPromise = (async () => {
        if (aborted()) return [];
        const people = await searchWorkspacePeople({
          workspaceId: searchWorkspaceId,
          term,
          limit,
        });
        if (aborted()) return [];
        return people.map((person) => ({
          id: person.id,
          type: "person" as const,
          title: person.name,
          description: person.jobTitle || undefined,
          userId: person.userId || undefined,
          workspaceId: searchWorkspaceId,
          createdAt: person.createdAt,
          relevanceScore: person.relevanceScore,
        }));
      })();
    }

    // PG-6: pages of the projects the caller reaches (staff only: this branch is closed to a
    // customer principal above).
    if ((type === "all" || type === "pages") && term) {
      pageResultsPromise = (async () => {
        if (aborted()) return [];
        const pageProjectIds = await projectsWithFeature(
          "feature.pages",
          searchWorkspaceId,
          reachable,
        );
        if (aborted()) return [];
        const pages = await searchProjectPages({
          workspaceId: searchWorkspaceId,
          reachableProjectIds: pageProjectIds,
          projectId,
          term,
          limit,
        });
        if (aborted()) return [];
        return pages.map((page) => ({
          id: page.id,
          type: "page" as const,
          title: page.title,
          description: page.snippet || undefined,
          projectId: page.projectId,
          projectName: page.projectName,
          projectSlug: page.projectSlug,
          workspaceId: page.workspaceId,
          createdAt: page.createdAt,
          relevanceScore: page.relevanceScore,
        }));
      })();
    }

    if ((type === "all" || type === "views") && access && term) {
      viewResultsPromise = (async () => {
        if (aborted()) return [];
        const views = await searchSavedViews({
          workspaceId: searchWorkspaceId,
          personId: access.personId,
          userId: resolvedUserId,
          reachableProjectIds: itemProjectIds,
          term,
          limit,
        });
        if (aborted()) return [];
        return views.map((view) => ({
          id: view.id,
          type: "saved_view" as const,
          title: view.name,
          layout: view.layout,
          workspaceId: view.workspaceId,
          createdAt: view.createdAt,
          relevanceScore: view.relevanceScore,
        }));
      })();
    }

    if ((type === "all" || type === "kb_articles") && term && kbArticleAccess) {
      articleResultsPromise = (async () => {
        if (aborted()) return [];
        const canReadKb = await kbArticleAccess(searchWorkspaceId);
        if (aborted() || !canReadKb) return [];
        const kbWorkspaceIds = await kbEnabledWorkspaceIds([searchWorkspaceId]);
        if (aborted() || !kbWorkspaceIds.includes(searchWorkspaceId)) return [];
        const articles = await searchArticles({
          workspaceId: searchWorkspaceId,
          reachableProjectIds: reachable,
          projectId,
          // The KB vector indexes the stored text as written. Keep the raw query form for the
          // same Unicode tokenization used by the KB route; `term` is NFKC-normalized for the
          // other canonical search repositories.
          q: query.trim(),
          limit,
        });
        if (aborted()) return [];
        return articles.map((article) => ({
          id: article.id,
          type: "kb_article" as const,
          title: article.title,
          description: article.snippet || undefined,
          projectId: article.projectId ?? undefined,
          workspaceId: article.workspaceId,
          createdAt: new Date(article.createdAt),
          relevanceScore: article.relevanceScore,
        }));
      })();
    }
  }

  const projectResultsPromise =
    type === "all" || type === "projects"
      ? (async () => {
          if (aborted()) return [];
          const projects = await searchProjects({
            scope,
            searchPattern,
            limit,
          });
          if (aborted()) return [];
          return projects.map((project) => ({
            id: project.id,
            type: "project" as const,
            title: project.name,
            description: project.description || undefined,
            projectId: project.id,
            projectSlug: project.slug || undefined,
            workspaceId: project.workspaceId,
            workspaceName: project.workspaceName || undefined,
            createdAt: project.createdAt,
            relevanceScore: project.relevanceScore,
          }));
        })()
      : Promise.resolve([]);

  const workspaceResultsPromise =
    type === "all" || type === "workspaces"
      ? (async () => {
          if (aborted()) return [];
          const workspaces = await searchWorkspaces({
            identity,
            accessibleWorkspaceIds,
            searchPattern,
            limit,
          });
          if (aborted()) return [];
          return workspaces.map((workspace) => ({
            id: workspace.id,
            type: "workspace" as const,
            title: workspace.name,
            description: workspace.description || undefined,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            createdAt: workspace.createdAt,
            relevanceScore: workspace.relevanceScore,
          }));
        })()
      : Promise.resolve([]);

  const [
    peopleResults,
    pageResults,
    viewResults,
    articleResults,
    projectResults,
    workspaceResults,
  ] = await Promise.all([
    peopleResultsPromise,
    pageResultsPromise,
    viewResultsPromise,
    articleResultsPromise,
    projectResultsPromise,
    workspaceResultsPromise,
  ]);
  if (aborted()) return emptyResult();
  results.push(
    ...peopleResults,
    ...pageResults,
    ...viewResults,
    ...articleResults,
    ...projectResults,
    ...workspaceResults,
  );

  if (type === "comments" || type === "activities") {
    const activities = await searchActivities({
      scope,
      projectId,
      type,
      searchPattern,
      limit,
    });
    if (aborted()) return emptyResult();

    for (const activity of activities) {
      const isComment = activity.type === "comment";
      const activityContent = getActivitySearchContent(
        activity.type,
        activity.content,
        activity.eventData,
      );
      results.push({
        id: activity.id,
        type: isComment ? "comment" : "activity",
        title: isComment
          ? `Comment on ${activity.taskTitle || "task"}`
          : `${activity.type} on ${activity.taskTitle || "task"}`,
        content: activityContent,
        projectId: activity.projectId || undefined,
        projectName: activity.projectName || undefined,
        projectSlug: activity.projectSlug || undefined,
        workspaceId: activity.workspaceId || undefined,
        workspaceName: activity.workspaceName || undefined,
        userId: activity.userId || undefined,
        userName: activity.userName || undefined,
        createdAt: activity.createdAt,
        relevanceScore: activity.relevanceScore,
        taskNumber: activity.taskNumber || undefined,
      });
    }
  }

  results.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const finalResults = results.slice(0, limit);

  return {
    results: finalResults,
    totalCount: results.length,
    searchQuery: query,
  };
}

export default globalSearch;

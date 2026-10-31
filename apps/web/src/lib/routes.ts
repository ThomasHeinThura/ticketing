import { godModeRedirectPath } from "./god-mode-paths";
import {
  type DashboardSearch,
  parseDashboardSearch,
  parseReportBuilderSearch,
  parseReportsIndexSearch,
  type ReportBuilderSearch,
  type ReportSearch,
  type ReportsIndexSearch,
  reportQuery,
} from "./report-search";
import { isCalendarDate, weekStart } from "./time-minutes";
import {
  parseWorkItemApprovalRequestSearch,
  type WorkItemApprovalRequestSearch,
} from "./work-item-approval-request-search";
import {
  parseWorkItemDetailSectionsSearch,
  type WorkItemDetailSectionsSearch,
} from "./work-item-detail-sections-search";
import {
  parseWorkItemHierarchySearch,
  type WorkItemHierarchySearch,
} from "./work-item-hierarchy-search";
import {
  parseWorkItemRelationsSearch,
  type WorkItemRelationsSearch,
} from "./work-item-relations-search";

// Canonical route helpers (AGENTS.md rule 4): every screen has a URL, and
// any filter/sort state it carries lives in the query string so a reload reproduces it
// exactly. `generatedRouteMetadata` is produced from both TanStack trees and checked
// against in-progress/complete screen inventory rows by `pnpm check:inventory`; not-started
// rows remain planned URLs. Builders below define URL state contracts exercised by tests.

export { generatedRouteMetadata } from "./generated-route-metadata";

import { generatedRouteMetadata } from "./generated-route-metadata";
import {
  appendWorkItemQueryState,
  isWorkItemSearchSortField,
  parseWorkItemListSearch,
  parseWorkItemQueryState,
  type WorkItemListSearch,
  type WorkItemQueryState,
} from "./work-item-list-search";

export * from "./work-item-list-search";

import { parseWorkItemGroup, type WorkItemGroup } from "./project-board-search";

/**
 * The `/work` route's search: the shared work-item list state plus the board's grouping
 * (`VW-13`, `VW-1`). `group` lives here, not in the shared list codec, because saved views
 * share that codec and a grouping is not part of a saved query. `state` is the default and a
 * link that names it still parses; the builder never writes it.
 */
export type WorkItemWorkSearch = WorkItemListSearch & {
  group?: WorkItemGroup;
  combined?: "descendants";
};

export function parseWorkItemWorkSearch(raw: unknown): WorkItemWorkSearch {
  const group = parseWorkItemGroup((raw as { group?: unknown } | null)?.group);
  const list = parseWorkItemListSearch(raw);
  const combined = (raw as { combined?: unknown } | null)?.combined;
  return {
    ...list,
    ...(group ? { group } : {}),
    ...(list.layout === "board" && combined === "descendants"
      ? { combined: "descendants" as const }
      : {}),
  };
}

/**
 * Cycle and module detail search (P5 agile): the work surface under the burndown or progress
 * panel is the project's board or list. `board` is the default and is never written.
 */
export type AgileDetailSearch = { layout?: "list" };

export function parseAgileDetailSearch(raw: unknown): AgileDetailSearch {
  const layout = (raw as { layout?: unknown } | null)?.layout;
  return layout === "list" ? { layout: "list" } : {};
}

function agileDetailQuery(search: AgileDetailSearch) {
  return search.layout === "list" ? "?layout=list" : "";
}

export type LabelCatalogueSearch = {
  action?: "create" | "edit" | "delete";
  label?: string;
};

export function parseLabelCatalogueSearch(raw: unknown): LabelCatalogueSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.action === "create") return { action: "create" };
  if (
    (value.action === "edit" || value.action === "delete") &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    value.label.length <= 256 &&
    !value.label.includes("\0")
  )
    return { action: value.action, label: value.label };
  return {};
}

function labelCatalogueQuery(search: LabelCatalogueSearch) {
  const query = new URLSearchParams(
    parseLabelCatalogueSearch(search),
  ).toString();
  return query ? `?${query}` : "";
}

export type RouteSurface = keyof typeof generatedRouteMetadata;

function assertGeneratedRoute(surface: RouteSurface, template: string) {
  if (
    !(generatedRouteMetadata[surface] as readonly string[]).includes(template)
  )
    throw new Error(`Unknown generated ${surface} route: ${template}`);
}

/** Builds a path from a generated route template, requiring every dynamic segment. */
export function buildGeneratedRouteUrl(
  surface: RouteSurface,
  template: string,
  params: Record<string, string> = {},
): string {
  assertGeneratedRoute(surface, template);
  return template.replace(/\$([A-Za-z0-9_]+)/gu, (_match, name: string) => {
    const value = params[name];
    if (typeof value !== "string" || value.length === 0)
      throw new Error(`Route ${template} requires parameter ${name}.`);
    return encodeURIComponent(value);
  });
}

/** Parses a generated route URL and returns decoded dynamic segments, if it matches. */
export function parseGeneratedRouteUrl(
  surface: RouteSurface,
  template: string,
  input: string,
): { pathname: string; params: Record<string, string> } | undefined {
  assertGeneratedRoute(surface, template);
  const url = new URL(input, "https://route.invalid");
  const names: string[] = [];
  const pattern = template
    .split(/(\$[A-Za-z0-9_]+)/gu)
    .map((part) => {
      if (part.startsWith("$")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    })
    .join("");
  const match = new RegExp(`^${pattern}$`, "u").exec(url.pathname);
  if (!match) return undefined;
  const params = Object.fromEntries(
    names.map((name, index) => [name, decodeURIComponent(match[index + 1])]),
  );
  return { pathname: url.pathname, params };
}

export type WorkItemActivityFilter = "everything" | "comments" | "public";
export type WorkItemDetailSearch = WorkItemApprovalRequestSearch &
  WorkItemHierarchySearch &
  WorkItemRelationsSearch &
  WorkItemDetailSectionsSearch & {
    activity?: Exclude<WorkItemActivityFilter, "everything">;
    comment?: string;
  };
export type ProjectRouteParams = { workspaceId: string; projectId: string };

export const PROJECT_BACKLOG_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/backlog";
export const PROJECT_BOARD_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/board";
export const PROJECT_CALENDAR_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/calendar";
export const PROJECT_GANTT_PATH =
  "/dashboard/workspace/$workspaceId/project/$projectId/gantt";

export function parseWorkItemDetailSearch(raw: unknown): WorkItemDetailSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  return {
    ...parseWorkItemHierarchySearch(candidate),
    ...parseWorkItemRelationsSearch(candidate),
    ...parseWorkItemDetailSectionsSearch(candidate),
    ...parseWorkItemApprovalRequestSearch(candidate),
    ...(typeof candidate.comment === "string" &&
    /^[A-Za-z0-9_-]{1,256}$/u.test(candidate.comment)
      ? { comment: candidate.comment }
      : {}),
    ...(candidate.activity === "comments" || candidate.activity === "public"
      ? { activity: candidate.activity }
      : {}),
  };
}

export type GodModeOrganisationsSearch = { organisationId?: string };

export function parseGodModeOrganisationsSearch(
  raw: unknown,
): GodModeOrganisationsSearch {
  if (!raw || typeof raw !== "object") return {};
  const id = (raw as Record<string, unknown>).organisationId;
  return typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 128 &&
    !/\p{Cc}/u.test(id)
    ? { organisationId: id }
    : {};
}

export type GodModeUsersSearch = {
  q?: string;
  side?: "staff" | "customer";
  active?: "true" | "false";
  organisationId?: string;
  cursor?: string;
  user?: string;
  action?: GodModeUserAction;
};

export const GOD_MODE_USER_ACTIONS = [
  "suspend",
  "unsuspend",
  "grant-admin",
  "reset-mfa",
  "sign-out",
  "deactivate",
  "impersonate",
] as const;
export type GodModeUserAction = (typeof GOD_MODE_USER_ACTIONS)[number];

export function godModeUserActionBinding(
  userId: string | undefined,
  action: GodModeUserAction | undefined,
) {
  return userId && action ? `${userId}:${action}` : "";
}

export const IDENTITY_CONNECTION_TABS = [
  "connection",
  "scim",
  "events",
] as const;
export type IdentityConnectionTab = (typeof IDENTITY_CONNECTION_TABS)[number];

/** URL state of `/god-mode/authentication/{id}`: the open tab, the events page and the open SCIM mapping form. */
export type IdentityConnectionEditorSearch = {
  tab?: Exclude<IdentityConnectionTab, "connection">;
  /** Opaque events cursor (base64url, produced by the API). Only meaningful on the events tab. */
  eventsCursor?: string;
  /** A SCIM group mapping id being edited, or `new` for the add form. Only meaningful on the scim tab. */
  mapping?: string;
};

const EVENTS_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;

export function parseIdentityConnectionEditorSearch(
  raw: unknown,
): IdentityConnectionEditorSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (value.tab === "events") {
    return {
      tab: "events",
      ...(typeof value.eventsCursor === "string" &&
      EVENTS_CURSOR_PATTERN.test(value.eventsCursor)
        ? { eventsCursor: value.eventsCursor }
        : {}),
    };
  }
  if (value.tab === "scim") {
    return {
      tab: "scim",
      ...(typeof value.mapping === "string" &&
      value.mapping.length > 0 &&
      value.mapping.length <= 128
        ? { mapping: value.mapping }
        : {}),
    };
  }
  return {};
}

export function parseIdentityConnectionEditorSearchFromQueryString(
  queryString: string,
): IdentityConnectionEditorSearch {
  const params = new URLSearchParams(queryString);
  return parseIdentityConnectionEditorSearch({
    tab: params.get("tab") ?? undefined,
    eventsCursor: params.get("eventsCursor") ?? undefined,
    mapping: params.get("mapping") ?? undefined,
  });
}

export type PendingActionsSearch = { cursor?: string };
export const IMPORT_WIZARD_STEPS = [
  "connect",
  "discover",
  "mapping",
  "dry-run",
  "execute",
  "reconcile",
] as const;
export type ImportWizardStep = (typeof IMPORT_WIZARD_STEPS)[number];
/** Workspace selected in the God Mode import history and retained on run detail links; `step` is the open import-wizard step. */
export type GodModeImportsSearch = {
  workspaceId?: string;
  step?: ImportWizardStep;
};
/** Workspace customer invitations: which customer organisation is selected (CP-20). */
export type CustomerInvitationsSearch = { organisation?: string };
export type SavedViewsSearch = { query?: string };
/**
 * The URL form of a saved view (`SV-19`): the view's context (`workspaceId`, `scope`,
 * `scopeId`, `layout`) and its query properties as plain parameters, so a link fully encodes
 * it. Every part is optional; a URL naming all four context parts is a complete snapshot.
 */
export type SavedViewUrlSearch = {
  workspaceId?: string;
  scope?: "workspace" | "project";
  scopeId?: string;
  layout?: string;
} & WorkItemQueryState;

const SAVED_VIEW_URL_LAYOUTS = [
  "board",
  "list",
  "table",
  "calendar",
  "timeline",
  "chart",
] as const;

export function parsePendingActionsSearch(raw: unknown): PendingActionsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof value.cursor === "string" &&
    value.cursor.length > 0 &&
    value.cursor.length <= 2048
      ? value.cursor
      : undefined;
  return { cursor };
}

export function parseCustomerInvitationsSearch(
  raw: unknown,
): CustomerInvitationsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.organisation === "string" &&
    value.organisation.length > 0 &&
    value.organisation.length <= 128
    ? { organisation: value.organisation }
    : {};
}

export function parseSavedViewsSearch(raw: unknown): SavedViewsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof value.query === "string" && value.query.trim()
      ? { query: value.query.trim().slice(0, 200) }
      : {}),
  };
}

function boundedId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

export function parseGodModeImportsSearch(raw: unknown): GodModeImportsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const workspaceId = boundedId(value.workspaceId);
  const step = (IMPORT_WIZARD_STEPS as readonly unknown[]).includes(value.step)
    ? (value.step as ImportWizardStep)
    : undefined;
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(step ? { step } : {}),
  };
}

function godModeImportsQuery(search: GodModeImportsSearch) {
  const resolved = parseGodModeImportsSearch(search);
  const query = new URLSearchParams();
  if (resolved.workspaceId) query.set("workspaceId", resolved.workspaceId);
  if (resolved.step) query.set("step", resolved.step);
  return query.size ? `?${query}` : "";
}

/**
 * Parses a saved view's URL. Total and bounded like every route parser: each property that is
 * absent or invalid is simply omitted, and no default is added, so a link keeps meaning what
 * it said. `position` is the list's rank order and is not a saved-view sort.
 */
export function parseSavedViewUrlSearch(raw: unknown): SavedViewUrlSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const { sort, sorts, ...rest } = parseWorkItemQueryState(value);
  const workspaceId = boundedId(value.workspaceId);
  const scopeId = boundedId(value.scopeId);
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(value.scope === "workspace" || value.scope === "project"
      ? { scope: value.scope }
      : {}),
    ...(scopeId ? { scopeId } : {}),
    ...((SAVED_VIEW_URL_LAYOUTS as readonly unknown[]).includes(value.layout)
      ? { layout: value.layout as string }
      : {}),
    ...(isWorkItemSearchSortField(sort) ? { sort } : {}),
    ...(sorts ? { sorts } : {}),
    ...rest,
  };
}

export function parseSavedViewUrlSearchFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  return parseSavedViewUrlSearch({
    workspaceId: params.get("workspaceId") ?? undefined,
    scope: params.get("scope") ?? undefined,
    scopeId: params.get("scopeId") ?? undefined,
    layout: params.get("layout") ?? undefined,
    filter: params.get("filter") ?? undefined,
    filterMode: params.get("filterMode") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    sorts: params.get("sorts") ?? undefined,
    columns: params.get("columns") ?? undefined,
    item: params.get("item") ?? undefined,
    hierarchy: params.get("hierarchy") ?? undefined,
    relations: params.get("relations") ?? undefined,
    approvalRequest: params.get("approvalRequest") ?? undefined,
    sections: params.get("sections") ?? undefined,
  });
}

export type ProjectBacklogSearch = WorkItemApprovalRequestSearch &
  WorkItemHierarchySearch &
  WorkItemRelationsSearch &
  WorkItemDetailSectionsSearch & {
    filter?: string;
    filterMode?: "visual" | "text";
    item?: string;
  };

export function parseProjectBacklogSearch(raw: unknown): ProjectBacklogSearch {
  const {
    filter,
    filterMode,
    item,
    hierarchy,
    relations,
    approvalRequest,
    sections,
  } = parseWorkItemQueryState(raw);
  return {
    ...(filter ? { filter } : {}),
    ...(filterMode ? { filterMode } : {}),
    ...(item ? { item } : {}),
    ...(hierarchy ? { hierarchy } : {}),
    ...(relations ? { relations } : {}),
    ...(approvalRequest ? { approvalRequest } : {}),
    ...(sections ? { sections } : {}),
  };
}

export function parseProjectBacklogSearchFromQueryString(
  queryString: string,
): ProjectBacklogSearch {
  const params = new URLSearchParams(queryString);
  return parseProjectBacklogSearch({
    filter: params.get("filter") ?? undefined,
    filterMode: params.get("filterMode") ?? undefined,
    item: params.get("item") ?? undefined,
    hierarchy: params.get("hierarchy") ?? undefined,
    relations: params.get("relations") ?? undefined,
    approvalRequest: params.get("approvalRequest") ?? undefined,
    sections: params.get("sections") ?? undefined,
  });
}

export const AGENT_INBOX_FILTERS = [
  "all",
  "unread",
  "mentions",
  "assignments",
] as const;
export type AgentInboxFilter = (typeof AGENT_INBOX_FILTERS)[number];
export type AgentInboxSearch = {
  filter?: Exclude<AgentInboxFilter, "all">;
};

/** `project.kind` (PR-9): a delivery project or a managed service. */
export const PROJECT_KINDS = ["project", "managed_service"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export function isProjectKind(value: unknown): value is ProjectKind {
  return (PROJECT_KINDS as readonly unknown[]).includes(value);
}

/** S5: `kind` narrows the projects list to one engagement kind. */
export type AgentHomeSearch = { recovery?: "deleted"; kind?: ProjectKind };

export function parseAgentHomeSearch(raw: unknown): AgentHomeSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(value.recovery === "deleted" ? { recovery: "deleted" as const } : {}),
    ...(isProjectKind(value.kind) ? { kind: value.kind } : {}),
  };
}

export function parseAgentHomeSearchFromQueryString(
  queryString: string,
): AgentHomeSearch {
  const params = new URLSearchParams(queryString);
  return parseAgentHomeSearch({
    recovery: params.get("recovery") ?? undefined,
    kind: params.get("kind") ?? undefined,
  });
}

export function parseAgentInboxSearch(raw: unknown): AgentInboxSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return value.filter === "unread" ||
    value.filter === "mentions" ||
    value.filter === "assignments"
    ? { filter: value.filter }
    : {};
}

export function parseAgentInboxSearchFromQueryString(
  queryString: string,
): AgentInboxSearch {
  const params = new URLSearchParams(queryString);
  return parseAgentInboxSearch({ filter: params.get("filter") ?? undefined });
}

export type AgentMyWorkLens = "assigned" | "watching" | "approvals";
export type AgentMyWorkSearch = WorkItemApprovalRequestSearch &
  WorkItemHierarchySearch &
  WorkItemRelationsSearch &
  WorkItemDetailSectionsSearch & {
    lens?: Exclude<AgentMyWorkLens, "assigned">;
    q?: string;
    item?: string;
  };

export function parseAgentMyWorkSearch(raw: unknown): AgentMyWorkSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const { item, hierarchy, relations, approvalRequest, sections } =
    parseWorkItemQueryState(raw);
  const q =
    typeof value.q === "string" && value.q.trim()
      ? value.q.trim().slice(0, 200)
      : undefined;
  return {
    ...(value.lens === "watching" || value.lens === "approvals"
      ? { lens: value.lens }
      : {}),
    ...(q ? { q } : {}),
    ...(item ? { item } : {}),
    ...(hierarchy ? { hierarchy } : {}),
    ...(relations ? { relations } : {}),
    ...(approvalRequest ? { approvalRequest } : {}),
    ...(sections ? { sections } : {}),
  };
}

export function parseAgentMyWorkSearchFromQueryString(
  queryString: string,
): AgentMyWorkSearch {
  const params = new URLSearchParams(queryString);
  return parseAgentMyWorkSearch({
    lens: params.get("lens") ?? undefined,
    q: params.get("q") ?? undefined,
    item: params.get("item") ?? undefined,
    hierarchy: params.get("hierarchy") ?? undefined,
    relations: params.get("relations") ?? undefined,
    approvalRequest: params.get("approvalRequest") ?? undefined,
    sections: params.get("sections") ?? undefined,
  });
}

export type AgentGlobalSearchScope = "all" | "work-items" | "projects";
export type AgentGlobalSearch = {
  q?: string;
  scope?: Exclude<AgentGlobalSearchScope, "all">;
};

export function parseAgentGlobalSearch(raw: unknown): AgentGlobalSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const q =
    typeof value.q === "string" && value.q.trim()
      ? value.q.trim().slice(0, 200)
      : undefined;
  return {
    ...(q ? { q } : {}),
    ...(value.scope === "work-items" || value.scope === "projects"
      ? { scope: value.scope }
      : {}),
  };
}

export function parseAgentGlobalSearchFromQueryString(
  queryString: string,
): AgentGlobalSearch {
  const params = new URLSearchParams(queryString);
  return parseAgentGlobalSearch({
    q: params.get("q") ?? undefined,
    scope: params.get("scope") ?? undefined,
  });
}

export type SettingsTextFilterSearch = {
  q?: string;
};

export type CannedResponseSearch = SettingsTextFilterSearch & {
  id?: string;
  action?: "delete";
};
export function parseCannedResponseSearch(raw: unknown): CannedResponseSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const id =
    typeof value.id === "string" &&
    value.id.length <= 200 &&
    !value.id.includes("\u0000")
      ? value.id.trim()
      : undefined;
  return {
    ...parseSettingsTextFilterSearch(raw),
    ...(id
      ? {
          id,
          ...(value.action === "delete" ? { action: "delete" as const } : {}),
        }
      : {}),
  };
}

/** Team detail: `inactive=1` also lists deactivated members (kept for history, TM-8). */
export type TeamDetailSearch = { inactive?: boolean };
export function parseTeamDetailSearch(raw: unknown): TeamDetailSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return value.inactive === true ||
    value.inactive === "1" ||
    value.inactive === 1
    ? { inactive: true }
    : {};
}

/** Role editor tabs (RL-1..RL-13); `capabilities` is the default and is never written. */
export const ROLE_DETAIL_TABS = [
  "capabilities",
  "summary",
  "preview",
  "compare",
  "people",
  "history",
] as const;
export type RoleDetailTab = (typeof ROLE_DETAIL_TABS)[number];
/** Role editor: the open tab and, on `compare`, the role being compared with (RL-13). */
export type RoleDetailSearch = { tab?: RoleDetailTab; compare?: string };
export function parseRoleDetailSearch(raw: unknown): RoleDetailSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const tab = ROLE_DETAIL_TABS.find(
    (candidate) => candidate === value.tab && candidate !== "capabilities",
  );
  const compare =
    typeof value.compare === "string" &&
    value.compare.length > 0 &&
    value.compare.length <= 128 &&
    !value.compare.includes("\0")
      ? value.compare
      : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(compare ? { compare } : {}),
  };
}

/** Custom field list: `deleted=1` shows deleted fields inside their 30 day restore window (CF-8). */
export type CustomFieldListSearch = { deleted?: boolean };
export function parseCustomFieldListSearch(
  raw: unknown,
): CustomFieldListSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return value.deleted === true || value.deleted === "1" || value.deleted === 1
    ? { deleted: true }
    : {};
}

export type WorkItemTemplateSearch = SettingsTextFilterSearch & {
  /** The template being edited; `new` opens the create form. */
  id?: string;
  /** Which library the page shows; templates are the default. */
  library?: "checklists";
};
export function parseWorkItemTemplateSearch(
  raw: unknown,
): WorkItemTemplateSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const id =
    typeof value.id === "string" &&
    value.id.length <= 200 &&
    !value.id.includes("\u0000")
      ? value.id.trim()
      : undefined;
  return {
    ...parseSettingsTextFilterSearch(raw),
    ...(value.library === "checklists"
      ? { library: "checklists" as const }
      : {}),
    ...(id ? { id } : {}),
  };
}

export function parseSettingsTextFilterSearch(
  raw: unknown,
): SettingsTextFilterSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.q === "string" && value.q.trim()
    ? { q: value.q.trim().slice(0, 200) }
    : {};
}

export function parseGodModeUsersSearch(raw: unknown): GodModeUsersSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(typeof value.q === "string" && value.q.trim()
      ? { q: value.q.trim().slice(0, 200) }
      : {}),
    ...(value.side === "staff" || value.side === "customer"
      ? { side: value.side }
      : {}),
    ...(value.active === "true" || value.active === "false"
      ? { active: value.active }
      : {}),
    ...(typeof value.organisationId === "string" && value.organisationId
      ? { organisationId: value.organisationId }
      : {}),
    ...(typeof value.cursor === "string" && value.cursor
      ? { cursor: value.cursor }
      : {}),
    ...(typeof value.user === "string" && value.user
      ? {
          user: value.user,
          ...(GOD_MODE_USER_ACTIONS.includes(value.action as GodModeUserAction)
            ? { action: value.action as GodModeUserAction }
            : {}),
        }
      : {}),
  };
}

export type ServiceCalendarListSearch = { cursor?: string };
export type SlaPolicyListSearch = { cursor?: string };

export function parseSlaPolicyListSearch(raw: unknown): SlaPolicyListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof candidate.cursor === "string" &&
    candidate.cursor.length > 0 &&
    candidate.cursor.length <= 2048
      ? candidate.cursor
      : undefined;
  return { cursor };
}

export function parseServiceCalendarListSearch(
  raw: unknown,
): ServiceCalendarListSearch {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const cursor =
    typeof candidate.cursor === "string" &&
    candidate.cursor.length > 0 &&
    candidate.cursor.length <= 2048
      ? candidate.cursor
      : undefined;
  return { cursor };
}

export function parseServiceCalendarListSearchFromQueryString(
  queryString: string,
) {
  const params = new URLSearchParams(queryString);
  return parseServiceCalendarListSearch({
    cursor: params.get("cursor"),
  });
}

export type IntakeQueueSearch = {
  state?:
    | "new"
    | "clarifying"
    | "accepted"
    | "declined"
    | "duplicate"
    | "withdrawn";
  /** IQ19/21: opaque association of two persisted saved views. */
  queue?: string;
  /** Canonical work-item filter text for the paired half. */
  workItemFilter?: string;
  workItemSorts?: WorkItemQueryState["sorts"];
  workItemColumns?: WorkItemQueryState["columns"];
  workItemFilterMode?: WorkItemQueryState["filterMode"];
  ref?: string;
  cursor?: string;
  /** `IQ-19`/`IQ-21`: request type id. */
  requestType?: string;
  /** `IQ-21`: whether a triager has claimed the submission. */
  assignee?: IntakeAssigneeFilter;
  /** `IQ-21`: only submissions at least this old. */
  age?: IntakeAgeFilter;
};
export const INTAKE_ASSIGNEE_FILTERS = ["claimed", "unclaimed"] as const;
export type IntakeAssigneeFilter = (typeof INTAKE_ASSIGNEE_FILTERS)[number];
export const INTAKE_AGE_FILTERS = ["1d", "3d", "7d", "30d"] as const;
export type IntakeAgeFilter = (typeof INTAKE_AGE_FILTERS)[number];
export type RequestTypeEditorSearch = { requestTypeId?: string };
export type WorkflowSettingsSearch = { workflowId?: string };
export type PortalCatalogueSearch = { q?: string; key?: string };
/**
 * Timesheet (`TC-*`): the week is a Monday (`YYYY-MM-DD`); the current week is never written.
 * `scope=everyone` is the read-only people-by-day view for `time_entry:read_any` holders.
 */
export type TimesheetSearch = { week?: string; scope?: "everyone" };
export function parseTimesheetSearch(raw: unknown): TimesheetSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const week = isCalendarDate(value.week) ? weekStart(value.week) : undefined;
  return {
    ...(week ? { week } : {}),
    ...(value.scope === "everyone" ? { scope: "everyone" as const } : {}),
  };
}
/** Knowledge base list (`KB-13`/`KB-14`/`KB-16`): one screen, three views, all in the URL. */
export const KB_LIST_VIEWS = ["articles", "categories", "report"] as const;
export const KB_STATES = [
  "draft",
  "in_review",
  "published",
  "archived",
] as const;
export type KbListSearch = {
  view?: (typeof KB_LIST_VIEWS)[number];
  q?: string;
  state?: (typeof KB_STATES)[number];
  category?: string;
  overdue?: boolean;
};
export const KB_ARTICLE_TABS = ["article", "versions", "feedback"] as const;
export type KbArticleSearch = {
  tab?: (typeof KB_ARTICLE_TABS)[number];
  /** Version number shown in the history tab. */
  version?: number;
};
export type KbEditorSearch = { preview?: boolean };
export type PortalKbSearch = { q?: string; category?: string };

function kbText(value: unknown, max = 200) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\u0000")
    ? value
    : undefined;
}
export function parseKbListSearch(raw: unknown): KbListSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const view = KB_LIST_VIEWS.find((candidate) => candidate === value.view);
  const state = KB_STATES.find((candidate) => candidate === value.state);
  const q = kbText(value.q);
  const category = kbText(value.category);
  return {
    ...(view && view !== "articles" ? { view } : {}),
    ...(q ? { q } : {}),
    ...(state ? { state } : {}),
    ...(category ? { category } : {}),
    ...(value.overdue === true || value.overdue === "1"
      ? { overdue: true }
      : {}),
  };
}
export function parseKbArticleSearch(raw: unknown): KbArticleSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const tab = KB_ARTICLE_TABS.find((candidate) => candidate === value.tab);
  const version = Number(value.version);
  return {
    ...(tab && tab !== "article" ? { tab } : {}),
    ...(Number.isInteger(version) && version >= 1 && version <= 100000
      ? { version }
      : {}),
  };
}
export function parseKbEditorSearch(raw: unknown): KbEditorSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return value.preview === true || value.preview === "1"
    ? { preview: true }
    : {};
}
export function parsePortalKbSearch(raw: unknown): PortalKbSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const q = kbText(value.q);
  const category = kbText(value.category);
  return { ...(q ? { q } : {}), ...(category ? { category } : {}) };
}
function kbQuery(entries: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, entry] of Object.entries(entries))
    if (entry) query.set(key, entry);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

/** Service management (P5 `SVC-*`, `CH-*`, `REL-*`): every filter lives in the URL. */
export type ServiceListSearch = { q?: string };
export const CHANGE_CALENDAR_TABS = [
  "calendar",
  "freezes",
  "overrides",
] as const;
export type ChangeCalendarSearch = {
  /** First day of the visible month, `YYYY-MM`; the current month when absent. */
  month?: string;
  tab?: (typeof CHANGE_CALENDAR_TABS)[number];
};
export type ReleaseListSearch = { serviceId?: string };

function serviceManagementText(value: unknown, max = 200) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\u0000")
    ? value
    : undefined;
}
export function parseServiceListSearch(raw: unknown): ServiceListSearch {
  const q = serviceManagementText((raw as { q?: unknown } | null)?.q, 120);
  return q ? { q } : {};
}
export function parseChangeCalendarSearch(raw: unknown): ChangeCalendarSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const month =
    typeof value.month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/u.test(value.month)
      ? value.month
      : undefined;
  const tab = CHANGE_CALENDAR_TABS.find((candidate) => candidate === value.tab);
  return {
    ...(month ? { month } : {}),
    ...(tab && tab !== "calendar" ? { tab } : {}),
  };
}
export function parseReleaseListSearch(raw: unknown): ReleaseListSearch {
  const serviceId = serviceManagementText(
    (raw as { serviceId?: unknown } | null)?.serviceId,
    128,
  );
  return serviceId ? { serviceId } : {};
}
function serviceManagementQuery(entries: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, entry] of Object.entries(entries))
    if (entry) query.set(key, entry);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export type PortalInboxSearch = { filter?: "all" | "unread" | "mentions" };

export function parsePortalInboxSearch(raw: unknown): PortalInboxSearch {
  const filter = (raw as { filter?: unknown } | null)?.filter;
  return filter === "unread" || filter === "mentions" ? { filter } : {};
}

export type PortalSignInStage = "email" | "password" | "factor" | "otp";
export type PortalSignInSearch = {
  stage: PortalSignInStage;
  factor: "totp" | "backup";
  invitationId?: string;
};

export function parseWorkflowSettingsSearch(
  raw: unknown,
): WorkflowSettingsSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.workflowId === "string" &&
    value.workflowId.length > 0 &&
    value.workflowId.length <= 200
    ? { workflowId: value.workflowId }
    : {};
}

export function parseRequestTypeEditorSearch(
  raw: unknown,
): RequestTypeEditorSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.requestTypeId === "string" &&
    value.requestTypeId.length <= 200
    ? { requestTypeId: value.requestTypeId }
    : {};
}

export function parseIntakeSearch(raw: unknown): IntakeQueueSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const states = [
    "new",
    "clarifying",
    "accepted",
    "declined",
    "duplicate",
    "withdrawn",
  ] as const;
  const explicitState = states.find((candidate) => candidate === value.state);
  const ref =
    typeof value.ref === "string" && /^SUB-[1-9]\d{0,9}$/u.test(value.ref)
      ? value.ref
      : undefined;
  const cursor =
    typeof value.cursor === "string" && value.cursor.length <= 2048
      ? value.cursor
      : undefined;
  const requestType =
    typeof value.requestType === "string" &&
    value.requestType.length > 0 &&
    value.requestType.length <= 200
      ? value.requestType
      : undefined;
  const assignee = INTAKE_ASSIGNEE_FILTERS.find(
    (candidate) => candidate === value.assignee,
  );
  const age = INTAKE_AGE_FILTERS.find((candidate) => candidate === value.age);
  const queue =
    typeof value.queue === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(value.queue)
      ? value.queue
      : undefined;
  const workItemQuery = parseWorkItemQueryState({
    filter: value.workItemFilter,
    sorts:
      typeof value.workItemSorts === "string" &&
      value.workItemSorts.length > 2000
        ? undefined
        : value.workItemSorts,
    columns:
      typeof value.workItemColumns === "string" &&
      value.workItemColumns.length > 16384
        ? undefined
        : value.workItemColumns,
    filterMode: value.workItemFilterMode,
  });
  const state = explicitState ?? (queue ? undefined : "new");
  return {
    ...(state ? { state } : {}),
    ...(queue ? { queue } : {}),
    ...(workItemQuery.filter ? { workItemFilter: workItemQuery.filter } : {}),
    ...(workItemQuery.sorts ? { workItemSorts: workItemQuery.sorts } : {}),
    ...(workItemQuery.columns
      ? { workItemColumns: workItemQuery.columns }
      : {}),
    ...(workItemQuery.filterMode
      ? { workItemFilterMode: workItemQuery.filterMode }
      : {}),
    ...(ref ? { ref } : {}),
    ...(cursor ? { cursor } : {}),
    ...(requestType ? { requestType } : {}),
    ...(assignee ? { assignee } : {}),
    ...(age ? { age } : {}),
  };
}

export function parsePortalCatalogueSearch(
  raw: unknown,
): PortalCatalogueSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const q = typeof value.q === "string" ? value.q.slice(0, 200) : "";
  const key =
    typeof value.key === "string" && value.key.length <= 200
      ? value.key
      : undefined;
  return { ...(q ? { q } : {}), ...(key ? { key } : {}) };
}

export function parsePortalSignInSearch(raw: unknown): PortalSignInSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const stage = ["email", "password", "factor", "otp"].find(
    (candidate) => candidate === value.stage,
  ) as PortalSignInStage | undefined;
  return {
    stage: stage ?? "email",
    factor: value.factor === "backup" ? "backup" : "totp",
    ...(typeof value.invitationId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.invitationId)
      ? { invitationId: value.invitationId }
      : {}),
  };
}

/** Existing Kaneo account security, including an opaque session-bound linking intent. */
export type AccountSecuritySearch = {
  enrollmentRequired?: boolean;
  identityLinkIntent?: string;
};
export function parseAccountSecuritySearch(
  raw: unknown,
): AccountSecuritySearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(value.enrollmentRequired === true || value.enrollmentRequired === "true"
      ? { enrollmentRequired: true }
      : {}),
    ...(typeof value.identityLinkIntent === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(value.identityLinkIntent)
      ? { identityLinkIntent: value.identityLinkIntent }
      : {}),
  };
}

export const routes = {
  accountSecurity: {
    path: "/dashboard/settings/account/security" as const,
    build: (search: AccountSecuritySearch = {}) => {
      const resolved = parseAccountSecuritySearch(search);
      const query = new URLSearchParams();
      if (resolved.enrollmentRequired) query.set("enrollmentRequired", "true");
      if (resolved.identityLinkIntent)
        query.set("identityLinkIntent", resolved.identityLinkIntent);
      return `/dashboard/settings/account/security${query.size ? `?${query}` : ""}`;
    },
  },
  /** Kaneo account settings (L-03); the bare `/dashboard/settings[/account]` lands here. */
  accountInformation: {
    path: "/dashboard/settings/account/information" as const,
    build: () => "/dashboard/settings/account/information",
  },
  accountNotifications: {
    path: "/dashboard/settings/account/notifications" as const,
    build: () => "/dashboard/settings/account/notifications",
  },
  accountPreferences: {
    path: "/dashboard/settings/account/preferences" as const,
    build: () => "/dashboard/settings/account/preferences",
  },
  /** Personal API keys and service keys. */
  accountDeveloper: {
    path: "/dashboard/settings/account/developer" as const,
    build: () => "/dashboard/settings/account/developer",
  },
  /** `docs/screens.md` "Workspace — webhooks". */
  webhooks: { path: "/dashboard/settings/workspace/webhooks" as const },
  /** `docs/screens.md` "Webhook editor"; `new` creates. */
  webhookEditor: {
    path: "/dashboard/settings/workspace/webhooks/$id" as const,
    build: (params: { id: string }) =>
      `/dashboard/settings/workspace/webhooks/${encodeURIComponent(params.id)}`,
  },
  /** `docs/screens.md` "Webhook delivery history". */
  webhookDeliveries: {
    path: "/dashboard/settings/workspace/webhooks/$id/deliveries" as const,
    build: (params: { id: string }) =>
      `/dashboard/settings/workspace/webhooks/${encodeURIComponent(params.id)}/deliveries`,
  },
  /** `docs/screens.md` "Workspace — automations". */
  automations: { path: "/dashboard/settings/workspace/automations" as const },
  /** `docs/screens.md` "Workspace — customer invitations" (CP-20..CP-23). */
  customerInvitations: {
    path: "/dashboard/settings/workspace/customer-invitations" as const,
    build: (search: CustomerInvitationsSearch = {}) => {
      const resolved = parseCustomerInvitationsSearch(search);
      return resolved.organisation
        ? `/dashboard/settings/workspace/customer-invitations?organisation=${encodeURIComponent(resolved.organisation)}`
        : "/dashboard/settings/workspace/customer-invitations";
    },
  },
  /** `docs/screens.md` "Project — automations" (redirects into the Kaneo project settings). */
  projectAutomations: {
    path: "/agent/projects/$projectKey/settings/automations" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/automations`,
  },
  /** `docs/02-design/screen-inventory.md` "Workspace — service calendars". */
  serviceCalendars: {
    path: "/dashboard/settings/workspace/calendars" as const,
    build: (search: ServiceCalendarListSearch = {}) => {
      const resolved = parseServiceCalendarListSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/dashboard/settings/workspace/calendars?${suffix}`
        : "/dashboard/settings/workspace/calendars";
    },
  },
  /** `docs/02-design/screen-inventory.md` "Service calendar editor". */
  serviceCalendarEditor: {
    path: "/dashboard/settings/workspace/calendars/$id" as const,
    build: (params: { id: string }, year?: number) => {
      const path = `/dashboard/settings/workspace/calendars/${encodeURIComponent(params.id)}`;
      return year === undefined ? path : `${path}?year=${year}`;
    },
  },
  /** `docs/02-design/screen-inventory.md` "Workspace — SLA policies". */
  slaPolicies: {
    path: "/dashboard/settings/workspace/sla-policies" as const,
    build: (search: SlaPolicyListSearch = {}) => {
      const resolved = parseSlaPolicyListSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/dashboard/settings/workspace/sla-policies?${suffix}`
        : "/dashboard/settings/workspace/sla-policies";
    },
  },
  /** `docs/02-design/screen-inventory.md` "SLA policy editor". */
  slaPolicyEditor: {
    path: "/dashboard/settings/workspace/sla-policies/$id" as const,
    build: (params: { id: string }) =>
      `/dashboard/settings/workspace/sla-policies/${encodeURIComponent(params.id)}`,
  },
  requestTypes: {
    path: "/dashboard/settings/workspace/request-types" as const,
    build: (search: RequestTypeEditorSearch = {}) => {
      const resolved = parseRequestTypeEditorSearch(search);
      return resolved.requestTypeId
        ? `/dashboard/settings/workspace/request-types?requestTypeId=${encodeURIComponent(resolved.requestTypeId)}`
        : "/dashboard/settings/workspace/request-types";
    },
  },
  /** `WF-9`: workflow versions, validation and publish, in the settings frame. */
  workflowSettings: {
    path: "/dashboard/settings/workspace/workflows" as const,
    build: (search: WorkflowSettingsSearch = {}) => {
      const resolved = parseWorkflowSettingsSearch(search);
      return resolved.workflowId
        ? `/dashboard/settings/workspace/workflows?workflowId=${encodeURIComponent(resolved.workflowId)}`
        : "/dashboard/settings/workspace/workflows";
    },
  },
  intakeQueue: {
    path: "/agent/triage" as const,
    build: (search: IntakeQueueSearch = { state: "new" }) => {
      const resolved = parseIntakeSearch(search);
      const query = new URLSearchParams();
      if (resolved.state) query.set("state", resolved.state);
      if (resolved.workItemFilter)
        query.set("workItemFilter", resolved.workItemFilter);
      if (resolved.workItemSorts)
        query.set("workItemSorts", JSON.stringify(resolved.workItemSorts));
      if (resolved.workItemColumns)
        query.set("workItemColumns", JSON.stringify(resolved.workItemColumns));
      if (resolved.workItemFilterMode)
        query.set("workItemFilterMode", resolved.workItemFilterMode);
      if (resolved.queue) query.set("queue", resolved.queue);
      if (resolved.ref) query.set("ref", resolved.ref);
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      if (resolved.requestType) query.set("requestType", resolved.requestType);
      if (resolved.assignee) query.set("assignee", resolved.assignee);
      if (resolved.age) query.set("age", resolved.age);
      return `/agent/triage?${query.toString()}`;
    },
  },
  /** `docs/screens.md` "Knowledge base", "Article view" and "Article editor" (P5, `KB-*`). */
  kb: {
    path: "/agent/kb" as const,
    build: (search: KbListSearch = {}) => {
      const resolved = parseKbListSearch(search);
      return `/agent/kb${kbQuery({
        view: resolved.view,
        q: resolved.q,
        state: resolved.state,
        category: resolved.category,
        overdue: resolved.overdue ? "1" : undefined,
      })}`;
    },
  },
  kbArticle: {
    path: "/agent/kb/$id" as const,
    build: (params: { id: string }, search: KbArticleSearch = {}) => {
      const resolved = parseKbArticleSearch(search);
      return `/agent/kb/${encodeURIComponent(params.id)}${kbQuery({
        tab: resolved.tab,
        version: resolved.version ? String(resolved.version) : undefined,
      })}`;
    },
  },
  kbArticleEdit: {
    path: "/agent/kb/$id/edit" as const,
    build: (params: { id: string }, search: KbEditorSearch = {}) =>
      `/agent/kb/${encodeURIComponent(params.id)}/edit${kbQuery({
        preview: parseKbEditorSearch(search).preview ? "1" : undefined,
      })}`,
  },
  /** `docs/screens.md` "Services list" and "Service detail" (P5, `SVC-*`). */
  serviceManagementServices: {
    path: "/agent/service-management/services" as const,
    build: (search: ServiceListSearch = {}) =>
      `/agent/service-management/services${serviceManagementQuery({ q: parseServiceListSearch(search).q })}`,
  },
  serviceManagementServiceDetail: {
    path: "/agent/service-management/services/$id" as const,
    build: (params: { id: string }) =>
      `/agent/service-management/services/${encodeURIComponent(params.id)}`,
  },
  /** `docs/screens.md` "Change calendar" (P5, `CH-4`, `CH-5`): calendar, freezes and the override report. */
  serviceManagementChanges: {
    path: "/agent/service-management/changes" as const,
    build: (search: ChangeCalendarSearch = {}) => {
      const resolved = parseChangeCalendarSearch(search);
      return `/agent/service-management/changes${serviceManagementQuery({ month: resolved.month, tab: resolved.tab })}`;
    },
  },
  /** `docs/screens.md` "Releases" (P5, `REL-*`). */
  serviceManagementReleases: {
    path: "/agent/service-management/releases" as const,
    build: (search: ReleaseListSearch = {}) =>
      `/agent/service-management/releases${serviceManagementQuery({ serviceId: parseReleaseListSearch(search).serviceId })}`,
  },
  serviceManagementReleaseDetail: {
    path: "/agent/service-management/releases/$id" as const,
    build: (params: { id: string }) =>
      `/agent/service-management/releases/${encodeURIComponent(params.id)}`,
  },
  /** Customer portal home, rooted on its separate origin. */
  portalHome: {
    path: "/" as const,
    build: () => "/",
    parse: (pathname: string) => (pathname === "/" ? "/" : undefined),
  },
  portalSignIn: {
    path: "/sign-in" as const,
    build: (search: Partial<PortalSignInSearch> = {}) => {
      const resolved = parsePortalSignInSearch(search);
      const query = new URLSearchParams({ stage: resolved.stage });
      if (resolved.invitationId)
        query.set("invitationId", resolved.invitationId);
      if (resolved.stage === "factor" && resolved.factor === "backup")
        query.set("factor", "backup");
      return `/sign-in?${query.toString()}`;
    },
  },
  /** Portal knowledge base, host-root like every portal route. */
  portalKb: {
    path: "/kb" as const,
    build: (search: PortalKbSearch = {}) => {
      const resolved = parsePortalKbSearch(search);
      return `/kb${kbQuery({ q: resolved.q, category: resolved.category })}`;
    },
  },
  portalKbArticle: {
    path: "/kb/$id" as const,
    build: (params: { id: string }) => `/kb/${encodeURIComponent(params.id)}`,
  },
  portalReleases: {
    path: "/releases" as const,
    build: (search: { cursor?: string } = {}) => {
      const { cursor } = parsePortalReleasesSearch(search);
      return cursor
        ? `/releases?${new URLSearchParams({ cursor })}`
        : "/releases";
    },
  },
  portalRelease: {
    path: "/releases/$id" as const,
    build: (params: { id: string }) =>
      `/releases/${encodeURIComponent(params.id)}`,
  },
  portalCatalogue: {
    path: "/catalogue" as const,
    build: (search: PortalCatalogueSearch = {}) => {
      const resolved = parsePortalCatalogueSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.key) query.set("key", resolved.key);
      const suffix = query.toString();
      return suffix ? `/catalogue?${suffix}` : "/catalogue";
    },
  },
  portalInbox: {
    path: "/notifications" as const,
    build: (search: PortalInboxSearch = {}) => {
      const { filter } = parsePortalInboxSearch(search);
      return filter
        ? `/notifications?${new URLSearchParams({ filter })}`
        : "/notifications";
    },
  },
  portalRequests: {
    path: "/requests" as const,
    build: (search: { cursor?: string; view?: "backlog" } = {}) => {
      const { cursor, view } = parsePortalRequestsSearch(search);
      const params = new URLSearchParams();
      if (view) params.set("view", view);
      if (cursor) params.set("cursor", cursor);
      return params.size ? `/requests?${params}` : "/requests";
    },
  },
  portalAccount: {
    path: "/account" as const,
    build: () => "/account",
  },
  portalApprovals: {
    path: "/approvals" as const,
    build: (search: { approval?: string } = {}) => {
      const { approval } = parsePortalApprovalsSearch(search);
      return approval
        ? `/approvals?${new URLSearchParams({ approval })}`
        : "/approvals";
    },
  },
  /**
   * `docs/screens.md` "Accept invitation" (CP-24). Host root on the portal origin. The accept
   * credential travels in the URL fragment (`#t=`), never in the path or query string.
   */
  portalInvite: {
    path: "/invite/$id" as const,
    build: (params: { id: string }) =>
      `/invite/${encodeURIComponent(params.id)}`,
  },
  portalSubmission: {
    path: "/submissions/$ref" as const,
    build: (params: { ref: string }) =>
      `/submissions/${encodeURIComponent(params.ref)}`,
  },
  /** `docs/02-design/screen-inventory.md` "Work — list", `/agent/projects/{key}/work`. */
  workItemList: {
    path: "/agent/projects/$projectKey/work" as const,
    build: (
      params: { projectKey: string },
      search: Partial<WorkItemWorkSearch> = {},
    ) => {
      const resolved = parseWorkItemWorkSearch(search);
      const query = new URLSearchParams({
        layout: resolved.layout,
        sort: resolved.sort,
        dir: resolved.dir,
      });
      if (resolved.group && resolved.group !== "state")
        query.set("group", resolved.group);
      if (resolved.combined) query.set("combined", resolved.combined);
      appendWorkItemQueryState(query, {
        filter: resolved.filter,
        filterMode: resolved.filterMode,
        sorts: resolved.sorts,
        columns: resolved.columns,
        item: resolved.item,
        hierarchy: resolved.hierarchy,
        relations: resolved.relations,
        approvalRequest: resolved.approvalRequest,
        sections: resolved.sections,
      });
      return `/agent/projects/${encodeURIComponent(params.projectKey)}/work?${query.toString()}`;
    },
  },
  /** `docs/02-design/screen-inventory.md` "Backlog", `/agent/projects/{key}/backlog`. */
  projectBacklog: {
    path: "/agent/projects/$projectKey/backlog" as const,
    build: (
      params: { projectKey: string },
      search: Partial<ProjectBacklogSearch> = {},
    ) => {
      const resolved = parseProjectBacklogSearch(search);
      const query = new URLSearchParams();
      if (resolved.filter) query.set("filter", resolved.filter);
      if (resolved.filterMode) query.set("filterMode", resolved.filterMode);
      if (resolved.item) query.set("item", resolved.item);
      if (resolved.hierarchy)
        query.set("hierarchy", JSON.stringify(resolved.hierarchy));
      if (resolved.relations)
        query.set("relations", JSON.stringify(resolved.relations));
      if (resolved.approvalRequest)
        query.set("approvalRequest", JSON.stringify(resolved.approvalRequest));
      if (resolved.sections)
        query.set("sections", JSON.stringify(resolved.sections));
      const suffix = query.toString();
      const base = `/agent/projects/${encodeURIComponent(params.projectKey)}/backlog`;
      return suffix ? `${base}?${suffix}` : base;
    },
  },
  /**
   * `docs/02-design/screen-inventory.md` "Work item — full page",
   * `/agent/work-items/{key}` -- the read-only first slice of the detail page (the
   * route itself has existed since #306, resolving to an honest stub; that stub is now
   * the real page). The list's rows still link here as their row-open destination, and
   * the URL contract did not change when the real page landed.
   */
  workItemDetail: {
    path: "/agent/work-items/$key" as const,
    build: (
      params: { key: string },
      search: Partial<WorkItemDetailSearch> = {},
    ) => {
      const resolved = parseWorkItemDetailSearch(search);
      const query = new URLSearchParams();
      if (resolved.activity) query.set("activity", resolved.activity);
      if (resolved.comment) query.set("comment", resolved.comment);
      if (resolved.hierarchy)
        query.set("hierarchy", JSON.stringify(resolved.hierarchy));
      if (resolved.relations)
        query.set("relations", JSON.stringify(resolved.relations));
      if (resolved.approvalRequest)
        query.set("approvalRequest", JSON.stringify(resolved.approvalRequest));
      if (resolved.sections)
        query.set("sections", JSON.stringify(resolved.sections));
      const suffix = query.toString();
      return `/agent/work-items/${encodeURIComponent(params.key)}${suffix ? `?${suffix}` : ""}`;
    },
  },
  /** `docs/02-design/screen-inventory.md` "Saved views index", `/agent/views`. */
  savedViews: {
    path: "/agent/views" as const,
    build: (search: SavedViewsSearch = {}) => {
      const resolved = parseSavedViewsSearch(search);
      const query = new URLSearchParams();
      if (resolved.query) query.set("query", resolved.query);
      const suffix = query.toString();
      return suffix ? `/agent/views?${suffix}` : "/agent/views";
    },
  },
  /**
   * `docs/02-design/screen-inventory.md` "Saved view", `/agent/views/{id}`. The query string
   * encodes the whole view (`SV-19`), so the link can be shared with someone who cannot open
   * the saved view itself.
   */
  savedView: {
    path: "/agent/views/$id" as const,
    build: (params: { id: string }, search: SavedViewUrlSearch = {}) => {
      const resolved = parseSavedViewUrlSearch(search);
      const query = new URLSearchParams();
      if (resolved.workspaceId) query.set("workspaceId", resolved.workspaceId);
      if (resolved.scope) query.set("scope", resolved.scope);
      if (resolved.scopeId) query.set("scopeId", resolved.scopeId);
      if (resolved.layout) query.set("layout", resolved.layout);
      appendWorkItemQueryState(query, resolved);
      const suffix = query.toString();
      return `/agent/views/${encodeURIComponent(params.id)}${suffix ? `?${suffix}` : ""}`;
    },
  },
  /** God Mode Users directory and its query-string-backed selection/filters. */
  notificationProvider: {
    path: "/god-mode/notifications" as const,
    build: () => "/god-mode/notifications",
  },
  /** God Mode home: the Health landing page, at the agent host root (L-03, Thomas 30 Oct). */
  godModeHealth: {
    path: "/god-mode" as const,
    build: () => "/god-mode",
  },
  /**
   * God Mode's own sign-in (password and MFA only, no SSO). `redirect` is honoured only when it
   * is a safe same-origin God Mode path; anything else opens God Mode home.
   */
  godModeSignIn: {
    path: "/god-mode/sign-in" as const,
    build: (search: { redirect?: string } = {}) => {
      const redirect = search.redirect
        ? godModeRedirectPath(search.redirect)
        : undefined;
      return redirect && redirect !== "/god-mode"
        ? `/god-mode/sign-in?${new URLSearchParams({ redirect })}`
        : "/god-mode/sign-in";
    },
  },
  /** God Mode log levels, local factor policy and the metrics scrape token. */
  godModeObservability: {
    path: "/god-mode/observability" as const,
    build: () => "/god-mode/observability",
  },
  /** God Mode General and Storage settings (`instance_setting`). */
  godModeGeneral: {
    path: "/god-mode/general" as const,
    build: () => "/god-mode/general",
  },
  /** `ST-1`, `ST-2`: God Mode instance feature switches and locks. */
  godModeFeatures: {
    path: "/god-mode/features" as const,
    build: () => "/god-mode/features",
  },
  /** `AK-7`: God Mode inventory of every API key on the instance. */
  godModeWebhooks: {
    path: "/god-mode/webhooks" as const,
    build: () => "/god-mode/webhooks",
  },
  godModeJobs: {
    path: "/god-mode/jobs" as const,
    build: () => "/god-mode/jobs",
  },
  godModePlugins: {
    path: "/god-mode/plugins" as const,
    build: () => "/god-mode/plugins",
  },
  godModeStorage: {
    path: "/god-mode/storage" as const,
    build: () => "/god-mode/storage",
  },
  godModeMcpUsage: {
    path: "/god-mode/mcp" as const,
    build: () => "/god-mode/mcp",
  },
  godModeImports: {
    path: "/god-mode/imports" as const,
    build: (search: GodModeImportsSearch = {}) =>
      `/god-mode/imports${godModeImportsQuery(search)}`,
  },
  godModeImportRun: {
    path: "/god-mode/imports/$id" as const,
    build: (params: { id: string }, search: GodModeImportsSearch = {}) =>
      `/god-mode/imports/${encodeURIComponent(params.id)}${godModeImportsQuery(search)}`,
  },
  godModeDeliveries: {
    path: "/god-mode/deliveries" as const,
    build: () => "/god-mode/deliveries",
  },
  godModeApiKeys: {
    path: "/god-mode/api-keys" as const,
    build: () => "/god-mode/api-keys",
  },
  godModeAudit: {
    path: "/god-mode/audit" as const,
    build: (search: { action?: string; limit?: number } = {}) => {
      const resolved = parseInstanceAuditSearch(search);
      const params = new URLSearchParams({ limit: String(resolved.limit) });
      if (resolved.action) params.set("action", resolved.action);
      return `/god-mode/audit?${params}`;
    },
  },
  godModeOrganisations: {
    path: "/god-mode/organisations" as const,
    build: (search: GodModeOrganisationsSearch = {}) => {
      const resolved = parseGodModeOrganisationsSearch(search);
      const query = new URLSearchParams();
      if (resolved.organisationId)
        query.set("organisationId", resolved.organisationId);
      return `/god-mode/organisations${query.size ? `?${query}` : ""}`;
    },
  },
  godModeUsers: {
    path: "/god-mode/users" as const,
    build: (search: Partial<GodModeUsersSearch> = {}) => {
      const resolved = parseGodModeUsersSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.side) query.set("side", resolved.side);
      if (resolved.active) query.set("active", resolved.active);
      if (resolved.organisationId)
        query.set("organisationId", resolved.organisationId);
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      if (resolved.user) query.set("user", resolved.user);
      if (resolved.user && resolved.action)
        query.set("action", resolved.action);
      const suffix = query.toString();
      return suffix ? `/god-mode/users?${suffix}` : "/god-mode/users";
    },
  },
  /** `docs/02-design/screen-inventory.md` "Authentication providers". */
  identityConnections: {
    path: "/god-mode/authentication" as const,
    build: () => "/god-mode/authentication",
  },
  /** `docs/02-design/screen-inventory.md` "Provider editor"; the id `new` opens the create form. */
  identityConnectionEditor: {
    path: "/god-mode/authentication/$id" as const,
    build: (
      params: { id: string },
      search: IdentityConnectionEditorSearch = {},
    ) => {
      const resolved = parseIdentityConnectionEditorSearch(search);
      const query = new URLSearchParams();
      if (resolved.tab) query.set("tab", resolved.tab);
      if (resolved.eventsCursor)
        query.set("eventsCursor", resolved.eventsCursor);
      if (resolved.mapping) query.set("mapping", resolved.mapping);
      const suffix = query.toString();
      const path = `/god-mode/authentication/${encodeURIComponent(params.id)}`;
      return suffix ? `${path}?${suffix}` : path;
    },
  },
  /** God Mode organisation "Identity" tab (CP-17, IP-5): the customer organisation's own OIDC connection and SCIM. */
  organisationIdentity: {
    path: "/god-mode/organisations/$id/identity" as const,
    build: (
      params: { id: string },
      search: IdentityConnectionEditorSearch = {},
    ) => {
      const resolved = parseIdentityConnectionEditorSearch(search);
      const query = new URLSearchParams();
      if (resolved.tab) query.set("tab", resolved.tab);
      if (resolved.eventsCursor)
        query.set("eventsCursor", resolved.eventsCursor);
      if (resolved.mapping) query.set("mapping", resolved.mapping);
      const suffix = query.toString();
      const path = `/god-mode/organisations/${encodeURIComponent(params.id)}/identity`;
      return suffix ? `${path}?${suffix}` : path;
    },
  },
  /** PA-6 requester-owned browser approval list and item. */
  pendingActions: {
    path: "/dashboard/settings/account/pending-actions" as const,
    build: (search: PendingActionsSearch = {}) => {
      const resolved = parsePendingActionsSearch(search);
      const query = new URLSearchParams();
      if (resolved.cursor) query.set("cursor", resolved.cursor);
      const suffix = query.toString();
      return suffix
        ? `/dashboard/settings/account/pending-actions?${suffix}`
        : "/dashboard/settings/account/pending-actions";
    },
  },
  pendingAction: {
    path: "/dashboard/settings/account/pending-actions/$id" as const,
    build: (params: { id: string }) =>
      `/dashboard/settings/account/pending-actions/${encodeURIComponent(params.id)}`,
  },
  agentHome: {
    path: "/agent" as const,
    build: (search: AgentHomeSearch = {}) => {
      const resolved = parseAgentHomeSearch(search);
      const query = new URLSearchParams();
      if (resolved.recovery) query.set("recovery", resolved.recovery);
      if (resolved.kind) query.set("kind", resolved.kind);
      const suffix = query.toString();
      return suffix ? `/agent?${suffix}` : "/agent";
    },
  },
  agentInbox: {
    path: "/agent/inbox" as const,
    build: (search: AgentInboxSearch = {}) => {
      const resolved = parseAgentInboxSearch(search);
      return resolved.filter
        ? `/agent/inbox?filter=${resolved.filter}`
        : "/agent/inbox";
    },
  },
  agentMyWork: {
    path: "/agent/my-work" as const,
    build: (search: AgentMyWorkSearch = {}) => {
      const resolved = parseAgentMyWorkSearch(search);
      const query = new URLSearchParams();
      if (resolved.lens) query.set("lens", resolved.lens);
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.item) query.set("item", resolved.item);
      if (resolved.hierarchy)
        query.set("hierarchy", JSON.stringify(resolved.hierarchy));
      if (resolved.relations)
        query.set("relations", JSON.stringify(resolved.relations));
      if (resolved.approvalRequest)
        query.set("approvalRequest", JSON.stringify(resolved.approvalRequest));
      if (resolved.sections)
        query.set("sections", JSON.stringify(resolved.sections));
      const suffix = query.toString();
      return suffix ? `/agent/my-work?${suffix}` : "/agent/my-work";
    },
  },
  agentSearch: {
    path: "/agent/search" as const,
    build: (search: AgentGlobalSearch = {}) => {
      const resolved = parseAgentGlobalSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.scope) query.set("scope", resolved.scope);
      const suffix = query.toString();
      return suffix ? `/agent/search?${suffix}` : "/agent/search";
    },
  },
  // The page behind /agent/search: Kaneo's workspace search screen, now over canonical work
  // items. `q` and `scope` round-trip through the redirect and the page's own URL state.
  workspaceSearch: {
    path: "/dashboard/workspace/$workspaceId/search" as const,
    build: (
      params: { workspaceId: string },
      search: AgentGlobalSearch = {},
    ) => {
      const resolved = parseAgentGlobalSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.scope) query.set("scope", resolved.scope);
      const suffix = query.toString();
      const base = `/dashboard/workspace/${encodeURIComponent(params.workspaceId)}/search`;
      return suffix ? `${base}?${suffix}` : base;
    },
  },
  projectOverview: {
    path: "/agent/projects/$projectKey" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}`,
  },
  /** L-03: every old `/agent/settings/*` link (including `/agent/settings`) redirects to its canonical settings page. */
  legacySettings: { path: "/agent/settings/$" as const },
  /** Kaneo workspace settings landing page (L-03); the workspace switcher opens it. */
  workspaceGeneral: {
    path: "/dashboard/settings/workspace/general" as const,
    build: () => "/dashboard/settings/workspace/general",
  },
  workspaceTerminology: {
    path: "/dashboard/settings/workspace/terminology" as const,
    build: () => "/dashboard/settings/workspace/terminology",
  },
  workspaceFeatures: {
    path: "/dashboard/settings/workspace/features" as const,
    build: () => "/dashboard/settings/workspace/features",
  },
  workspaceMembers: {
    path: "/dashboard/settings/workspace/members" as const,
    build: (search: SettingsTextFilterSearch = {}) => {
      const resolved = parseSettingsTextFilterSearch(search);
      return resolved.q
        ? `/dashboard/settings/workspace/members?q=${encodeURIComponent(resolved.q)}`
        : "/dashboard/settings/workspace/members";
    },
  },
  workspaceStates: {
    path: "/dashboard/settings/workspace/states" as const,
    build: () => "/dashboard/settings/workspace/states",
  },
  workspaceLabels: {
    path: "/dashboard/settings/workspace/labels" as const,
    build: (search: LabelCatalogueSearch = {}) =>
      `/dashboard/settings/workspace/labels${labelCatalogueQuery(search)}`,
  },
  workspaceCannedResponses: {
    path: "/dashboard/settings/workspace/canned-responses" as const,
    build: (search: CannedResponseSearch = {}) => {
      const resolved = parseCannedResponseSearch(search);
      const query = new URLSearchParams(resolved).toString();
      return `/dashboard/settings/workspace/canned-responses${query ? `?${query}` : ""}`;
    },
  },
  workspaceWorkItemTemplates: {
    path: "/dashboard/settings/workspace/work-item-templates" as const,
    build: (search: WorkItemTemplateSearch = {}) => {
      const resolved = parseWorkItemTemplateSearch(search);
      const query = new URLSearchParams(resolved).toString();
      return `/dashboard/settings/workspace/work-item-templates${query ? `?${query}` : ""}`;
    },
  },
  /** `docs/screens.md` "Timesheet": the week grid (P5 time and cost). */
  timesheet: {
    path: "/agent/timesheet" as const,
    build: (search: TimesheetSearch = {}) => {
      const resolved = parseTimesheetSearch(search);
      const query = new URLSearchParams(resolved as Record<string, string>);
      return `/agent/timesheet${query.size ? `?${query}` : ""}`;
    },
  },
  /** `docs/screens.md` "Reports index" (P5 reports, `RP-*`): the directory of reports. */
  reports: {
    path: "/agent/reports" as const,
    build: (search: ReportsIndexSearch = {}) => {
      const resolved = parseReportsIndexSearch(search);
      return resolved.category
        ? `/agent/reports?category=${resolved.category}`
        : "/agent/reports";
    },
  },
  /** "Report detail": the whole filter state is in the query string (`RP-8`). */
  reportDetail: {
    path: "/agent/reports/$key" as const,
    build: (params: { key: string }, search: ReportSearch = {}) => {
      const query = reportQuery(search).toString();
      return `/agent/reports/${encodeURIComponent(params.key)}${query ? `?${query}` : ""}`;
    },
  },
  /**
   * "Report export" (`RP-10`, P5-R3-01): the page the "export ready" email links to. It shows the
   * queued export's status and offers the authenticated download; signed out, it signs in first.
   */
  reportExport: {
    path: "/agent/reports/exports/$id" as const,
    build: (params: { id: string }) =>
      `/agent/reports/exports/${encodeURIComponent(params.id)}`,
  },
  /** "Report builder" (tier 3); `view` opens a saved report. */
  reportBuilder: {
    path: "/agent/reports/new" as const,
    build: (search: ReportBuilderSearch = {}) => {
      const resolved = parseReportBuilderSearch(search);
      return resolved.view
        ? `/agent/reports/new?view=${encodeURIComponent(resolved.view)}`
        : "/agent/reports/new";
    },
  },
  /** "Dashboard" and "Dashboard editor": `id` names a dashboard, the default otherwise. */
  agentDashboard: {
    path: "/agent/dashboard" as const,
    build: (search: DashboardSearch = {}) => {
      const resolved = parseDashboardSearch(search);
      return resolved.id
        ? `/agent/dashboard?id=${encodeURIComponent(resolved.id)}`
        : "/agent/dashboard";
    },
  },
  agentDashboardEdit: {
    path: "/agent/dashboard/edit" as const,
    build: (search: DashboardSearch = {}) => {
      const resolved = parseDashboardSearch(search);
      return resolved.id
        ? `/agent/dashboard/edit?id=${encodeURIComponent(resolved.id)}`
        : "/agent/dashboard/edit";
    },
  },
  /** `docs/screens.md` "Workspace — rates" and "Workspace — time activities". */
  workspaceRates: {
    path: "/dashboard/settings/workspace/rates" as const,
    build: () => "/dashboard/settings/workspace/rates",
  },
  workspaceTimeActivities: {
    path: "/dashboard/settings/workspace/time-activities" as const,
    build: () => "/dashboard/settings/workspace/time-activities",
  },
  /** `docs/screens.md` "Workspace — teams" and "Team detail". */
  workspaceTeams: {
    path: "/dashboard/settings/workspace/teams" as const,
    build: () => "/dashboard/settings/workspace/teams",
  },
  workspaceTeamDetail: {
    path: "/dashboard/settings/workspace/teams/$id" as const,
    build: (params: { id: string }, search: TeamDetailSearch = {}) => {
      const base = `/dashboard/settings/workspace/teams/${encodeURIComponent(params.id)}`;
      return parseTeamDetailSearch(search).inactive
        ? `${base}?inactive=1`
        : base;
    },
  },
  /** `docs/screens.md` "Workspace — roles" and "Role editor". */
  workspaceRoles: {
    path: "/dashboard/settings/workspace/roles" as const,
    build: () => "/dashboard/settings/workspace/roles",
  },
  workspaceRoleDetail: {
    path: "/dashboard/settings/workspace/roles/$id" as const,
    build: (params: { id: string }, search: RoleDetailSearch = {}) => {
      const base = `/dashboard/settings/workspace/roles/${encodeURIComponent(params.id)}`;
      const query = new URLSearchParams(
        parseRoleDetailSearch(search) as Record<string, string>,
      ).toString();
      return query ? `${base}?${query}` : base;
    },
  },
  /** `docs/screens.md` "Workspace — custom fields (incl. sections)". */
  workspaceCustomFields: {
    path: "/dashboard/settings/workspace/custom-fields" as const,
    build: (search: CustomFieldListSearch = {}) =>
      parseCustomFieldListSearch(search).deleted
        ? "/dashboard/settings/workspace/custom-fields?deleted=1"
        : "/dashboard/settings/workspace/custom-fields",
  },
  /** `docs/screens.md` "Custom field editor"; `new` opens the create form. */
  workspaceCustomFieldEditor: {
    path: "/dashboard/settings/workspace/custom-fields/$id" as const,
    build: (params: { id: string }) =>
      `/dashboard/settings/workspace/custom-fields/${encodeURIComponent(params.id)}`,
  },
  /** The danger zone is part of General today (ST-8); this URL redirects there. */
  workspaceDangerZone: {
    path: "/dashboard/settings/workspace/danger" as const,
    build: () => "/dashboard/settings/workspace/danger",
  },
  projectSettings: {
    path: "/agent/projects/$projectKey/settings" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings`,
  },
  projectMembers: {
    path: "/agent/projects/$projectKey/settings/members" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/members`,
  },
  projectStates: {
    path: "/agent/projects/$projectKey/settings/states" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/states`,
  },
  projectLabels: {
    path: "/agent/projects/$projectKey/settings/labels" as const,
    build: (
      params: { projectKey: string },
      search: LabelCatalogueSearch = {},
    ) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/labels${labelCatalogueQuery(search)}`,
  },
  /** `ST-1`: per-project feature switches (redirects to Kaneo's project settings). */
  projectFeatures: {
    path: "/agent/projects/$projectKey/settings/features" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/features`,
  },
  /** `CY-1`..`CY-9` (P5): cycles list, shown only while `feature.cycles` resolves on. */
  projectCycles: {
    path: "/agent/projects/$projectKey/cycles" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/cycles`,
  },
  /** Cycle detail: burndown above the project's board or list, filtered to the cycle. */
  projectCycleDetail: {
    path: "/agent/projects/$projectKey/cycles/$cycleId" as const,
    build: (
      params: { projectKey: string; cycleId: string },
      search: AgileDetailSearch = {},
    ) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/cycles/${encodeURIComponent(params.cycleId)}${agileDetailQuery(search)}`,
  },
  /** `MO-1`..`MO-4` (P5): modules list, shown only while `feature.modules` resolves on. */
  projectModules: {
    path: "/agent/projects/$projectKey/modules" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/modules`,
  },
  projectModuleDetail: {
    path: "/agent/projects/$projectKey/modules/$moduleId" as const,
    build: (
      params: { projectKey: string; moduleId: string },
      search: AgileDetailSearch = {},
    ) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/modules/${encodeURIComponent(params.moduleId)}${agileDetailQuery(search)}`,
  },
  /** `PG-1`..`PG-8` (P5): staff-only project pages, a tree of long-form documents. */
  projectPages: {
    path: "/agent/projects/$projectKey/pages" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/pages`,
  },
  /** One page: view or edit, with the version history in a side panel. */
  projectPage: {
    path: "/agent/projects/$projectKey/pages/$pageId" as const,
    build: (params: { projectKey: string; pageId: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/pages/${encodeURIComponent(params.pageId)}`,
  },
  /** `ES-1`..`ES-3`: estimate system and cycle completion default (redirects to Kaneo's project settings). */
  projectEstimates: {
    path: "/agent/projects/$projectKey/settings/estimates" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/estimates`,
  },
  /** `TC-15`..`TC-19`: project budgets (redirects to Kaneo's project settings). */
  projectBudget: {
    path: "/agent/projects/$projectKey/settings/budget" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/budget`,
  },
  projectDangerZone: {
    path: "/agent/projects/$projectKey/settings/danger" as const,
    build: (params: { projectKey: string }) =>
      `/agent/projects/${encodeURIComponent(params.projectKey)}/settings/danger`,
  },
  /** Kaneo project settings pages (L-03); the `$projectKey` routes above redirect here. */
  projectSettingsGeneral: {
    path: "/dashboard/settings/projects/$projectId/general" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/general`,
  },
  projectSettingsMembers: {
    path: "/dashboard/settings/projects/$projectId/members" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/members`,
  },
  projectSettingsLabels: {
    path: "/dashboard/settings/projects/$projectId/labels" as const,
    build: (params: { projectId: string }, search: LabelCatalogueSearch = {}) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/labels${labelCatalogueQuery(search)}`,
  },
  projectSettingsWorkflow: {
    path: "/dashboard/settings/projects/$projectId/workflow" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/workflow`,
  },
  projectSettingsFeatures: {
    path: "/dashboard/settings/projects/$projectId/features" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/features`,
  },
  projectSettingsAutomations: {
    path: "/dashboard/settings/projects/$projectId/automations" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/automations`,
  },
  projectSettingsEstimates: {
    path: "/dashboard/settings/projects/$projectId/estimates" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/estimates`,
  },
  projectSettingsBudget: {
    path: "/dashboard/settings/projects/$projectId/budget" as const,
    build: (params: { projectId: string }) =>
      `/dashboard/settings/projects/${encodeURIComponent(params.projectId)}/budget`,
  },
};

export function parsePendingActionsSearchFromQueryString(queryString: string) {
  const params = new URLSearchParams(queryString);
  return parsePendingActionsSearch({ cursor: params.get("cursor") });
}

/** The inverse of `routes.workItemList.build`'s query string, for the round-trip test. */
export function parseWorkItemListSearchFromQueryString(
  queryString: string,
): WorkItemListSearch {
  const params = new URLSearchParams(queryString);
  return parseWorkItemListSearch({
    layout: params.get("layout") ?? undefined,
    sort: params.get("sort") ?? undefined,
    dir: params.get("dir") ?? undefined,
    sorts: params.get("sorts") ?? undefined,
    filter: params.get("filter") ?? undefined,
    filterMode: params.get("filterMode") ?? undefined,
    columns: params.get("columns") ?? undefined,
    item: params.get("item") ?? undefined,
    hierarchy: params.get("hierarchy") ?? undefined,
    relations: params.get("relations") ?? undefined,
    approvalRequest: params.get("approvalRequest") ?? undefined,
    sections: params.get("sections") ?? undefined,
  });
}

/** Opaque portal request cursors remain URL state; malformed values are discarded. */
export function parsePortalRequestsSearch(raw: unknown): {
  cursor?: string;
  view?: "backlog";
} {
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const cursor = candidate.cursor;
  return {
    ...(candidate.view === "backlog" ? { view: "backlog" as const } : {}),
    ...(typeof cursor === "string" &&
    cursor.length > 0 &&
    cursor.length <= 2048 &&
    /^[A-Za-z0-9_-]+$/u.test(cursor)
      ? { cursor }
      : {}),
  };
}

export function parsePortalReleasesSearch(raw: unknown): { cursor?: string } {
  const { cursor } = parsePortalRequestsSearch(raw);
  return cursor ? { cursor } : {};
}

export function parsePortalApprovalsSearch(raw: unknown): {
  approval?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const approval = (raw as Record<string, unknown>).approval;
  return typeof approval === "string" &&
    approval.length > 0 &&
    approval.length <= 256 &&
    /^[A-Za-z0-9_-]+$/u.test(approval)
    ? { approval }
    : {};
}

export function parseInstanceAuditSearch(raw: unknown): {
  action: string;
  limit: number;
} {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limit = Number(value.limit);
  return {
    action: typeof value.action === "string" ? value.action.slice(0, 256) : "",
    limit: [25, 50, 100, 200].includes(limit) ? limit : 50,
  };
}

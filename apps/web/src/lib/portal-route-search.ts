import type { SearchMiddleware } from "@tanstack/react-router";
export type PortalCatalogueSearch = PortalProjectSearch & {
  q?: string;
  key?: string;
};

export type PortalKbSearch = PortalProjectSearch & {
  q?: string;
  category?: string;
};

export function kbText(value: unknown, max = 200) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\u0000")
    ? value
    : undefined;
}

export function parsePortalKbSearch(raw: unknown): PortalKbSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const q = kbText(value.q);
  const category = kbText(value.category);
  return {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
    ...parsePortalProjectSearch(raw),
  };
}

export function kbQuery(entries: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, entry] of Object.entries(entries))
    if (entry) query.set(key, entry);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export type PortalInboxSearch = PortalProjectSearch & {
  filter?: "all" | "unread" | "mentions";
};

export function parsePortalInboxSearch(raw: unknown): PortalInboxSearch {
  const filter = (raw as { filter?: unknown } | null)?.filter;
  return {
    ...(filter === "unread" || filter === "mentions" ? { filter } : {}),
    ...parsePortalProjectSearch(raw),
  };
}

export type PortalSignInStage = "email" | "password" | "factor" | "otp";

export type PortalSignInSearch = {
  stage: PortalSignInStage;
  factor: "totp" | "backup";
  invitationId?: string;
  /** The portal page to open after sign-in: a same-origin path and query only. */
  redirect?: string;
};

export const PORTAL_REDIRECT_BASE = "https://portal.invalid";

export const PORTAL_REDIRECT_MAX_LENGTH = 2048;

export function isRelativePortalPath(value: string): boolean {
  return (
    value.length <= PORTAL_REDIRECT_MAX_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

export function safePortalRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !isRelativePortalPath(value))
    return undefined;
  let url: URL;
  try {
    url = new URL(value, PORTAL_REDIRECT_BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== PORTAL_REDIRECT_BASE) return undefined;
  const { pathname } = url;
  // Sign-in itself and the agent app's paths are never a portal destination. The router decodes
  // the path and matches case-insensitively when it navigates, so compare the decoded, lower-case
  // path with repeated and trailing slashes collapsed (`/%61gent/x`, `/SIGN-IN`, `/auth` and
  // `/portal//sign-in` are all blocked).
  let comparable: string;
  try {
    comparable = decodeURIComponent(pathname)
      .toLowerCase()
      .replace(/\/{2,}/gu, "/")
      .replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
  if (
    comparable === "/sign-in" ||
    comparable === "/portal/sign-in" ||
    comparable === "/agent" ||
    comparable.startsWith("/agent/") ||
    comparable === "/auth" ||
    comparable.startsWith("/auth/")
  )
    return undefined;
  const result = `${pathname}${url.search}`;
  // Dot segments can normalise into `//host`: check the value that is actually returned.
  return isRelativePortalPath(result) ? result : undefined;
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
  return {
    ...(q ? { q } : {}),
    ...(key ? { key } : {}),
    ...parsePortalProjectSearch(raw),
  };
}

export function parsePortalSignInSearch(raw: unknown): PortalSignInSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const redirect = safePortalRedirect(value.redirect);
  const stage = ["email", "password", "factor", "otp"].find(
    (candidate) => candidate === value.stage,
  ) as PortalSignInStage | undefined;
  // `invitationId` and `redirect` are always present, as `undefined` when rejected. TanStack
  // Router merges a child's validated search over its parent's, and the portal root keeps the raw
  // query: leaving a rejected key out would let the raw value (for example an external
  // `redirect`) reach `Route.useSearch()` unvalidated.
  return {
    stage: stage ?? "email",
    factor: value.factor === "backup" ? "backup" : "totp",
    invitationId:
      typeof value.invitationId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(value.invitationId)
        ? value.invitationId
        : undefined,
    redirect,
  };
}

export function parsePortalRequestsSearch(raw: unknown): PortalRequestsSearch {
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const cursor = candidate.cursor;
  return {
    ...parsePortalProjectSearch(raw),
    ...(candidate.view === "backlog" ? { view: "backlog" as const } : {}),
    ...parsePortalCaseFilterSearch(raw),
    ...(typeof cursor === "string" &&
    cursor.length > 0 &&
    cursor.length <= 2048 &&
    /^[A-Za-z0-9_-]+$/u.test(cursor)
      ? { cursor }
      : {}),
  };
}

export function parsePortalReleasesSearch(
  raw: unknown,
): PortalProjectSearch & { cursor?: string } {
  const { cursor, project } = parsePortalRequestsSearch(raw);
  return { ...(cursor ? { cursor } : {}), ...(project ? { project } : {}) };
}

export function parsePortalAnnouncementsSearch(
  raw: unknown,
): PortalProjectSearch & { cursor?: string } {
  return parsePortalReleasesSearch(raw);
}

export function parsePortalApprovalsSearch(
  raw: unknown,
): PortalProjectSearch & {
  approval?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const approval = (raw as Record<string, unknown>).approval;
  return {
    ...(typeof approval === "string" &&
    approval.length > 0 &&
    approval.length <= 256 &&
    /^[A-Za-z0-9_-]+$/u.test(approval)
      ? { approval }
      : {}),
    ...parsePortalProjectSearch(raw),
  };
}

export type PortalProjectSearch = { project?: string };

export function parsePortalProjectSearch(raw: unknown): PortalProjectSearch {
  if (!raw || typeof raw !== "object") return {};
  const project = (raw as Record<string, unknown>).project;
  return typeof project === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(project)
    ? { project }
    : {};
}

export const portalProjectSearchMiddlewares: SearchMiddleware<PortalProjectSearch>[] =
  [
    ({ search, next }) => {
      const result = next(search);
      const { project } = parsePortalProjectSearch(search);
      return project && !Object.hasOwn(result, "project")
        ? { ...result, project }
        : result;
    },
  ];

export type PortalProjectsSearch = PortalProjectSearch & {
  tab?: "projects" | "services";
  q?: string;
};

export function parsePortalProjectsSearch(raw: unknown): PortalProjectsSearch {
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const tab = candidate.tab;
  const q = typeof candidate.q === "string" ? candidate.q.trim() : "";
  return {
    ...(tab === "projects" || tab === "services" ? { tab } : {}),
    ...(q && q.length <= 200 ? { q } : {}),
    ...parsePortalProjectSearch(raw),
  };
}

export function portalProjectQuery(query: URLSearchParams, search: unknown) {
  const { project } = parsePortalProjectSearch(search);
  if (project) query.set("project", project);
  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

export const PORTAL_CASE_STATUSES = [
  "received",
  "need_more_info",
  "in_progress",
  "resolved",
  "closed",
  "declined",
  "withdrawn",
] as const;

export type PortalCaseStatus = (typeof PORTAL_CASE_STATUSES)[number];

export const PORTAL_OUTSTANDING_STATUSES = [
  "received",
  "need_more_info",
  "in_progress",
] as const satisfies readonly PortalCaseStatus[];

export const PORTAL_CASE_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export type PortalCasePriority = (typeof PORTAL_CASE_PRIORITIES)[number];

export const PORTAL_CASE_SORTS = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const;

export type PortalCaseSort = (typeof PORTAL_CASE_SORTS)[number];

export type PortalCaseFilterSearch = {
  scope?: "all";
  status?: string;
  priority?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: Exclude<PortalCaseSort, "updated_desc">;
};

export type PortalHomeSearch = PortalProjectSearch &
  Pick<PortalCaseFilterSearch, "scope" | "status" | "priority">;

export type PortalRequestsSearch = PortalProjectSearch &
  PortalCaseFilterSearch & {
    cursor?: string;
    view?: "backlog";
  };

export function canonicalList(value: unknown, allowed: readonly string[]) {
  if (typeof value !== "string" || value.length > 200) return undefined;
  const parts = new Set(value.split(","));
  const kept = allowed.filter((item) => parts.has(item));
  return kept.length ? kept.join(",") : undefined;
}

export function isoDay(value: unknown) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? value
    : undefined;
}

export function parsePortalCaseFilterSearch(
  raw: unknown,
): PortalCaseFilterSearch {
  if (!raw || typeof raw !== "object") return {};
  const candidate = raw as Record<string, unknown>;
  const status = canonicalList(candidate.status, PORTAL_CASE_STATUSES);
  const priority = canonicalList(candidate.priority, PORTAL_CASE_PRIORITIES);
  const q =
    typeof candidate.q === "string" ? candidate.q.trim().slice(0, 200) : "";
  const from = isoDay(candidate.from);
  const to = isoDay(candidate.to);
  const sort = (PORTAL_CASE_SORTS as readonly unknown[]).includes(
    candidate.sort,
  )
    ? (candidate.sort as PortalCaseSort)
    : undefined;
  return {
    ...(candidate.scope === "all" ? { scope: "all" as const } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(q ? { q } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(sort && sort !== "updated_desc" ? { sort } : {}),
  };
}

export function parsePortalHomeSearch(raw: unknown): PortalHomeSearch {
  const { scope, status, priority } = parsePortalCaseFilterSearch(raw);
  return {
    ...parsePortalProjectSearch(raw),
    ...(scope ? { scope } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
  };
}

export function portalCaseFilterQuery(search: PortalCaseFilterSearch) {
  const query = new URLSearchParams();
  for (const key of [
    "scope",
    "status",
    "priority",
    "q",
    "from",
    "to",
    "sort",
  ] as const) {
    const value = search[key];
    if (value) query.set(key, value);
  }
  return query;
}

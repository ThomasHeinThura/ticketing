import {
  kbQuery,
  type PortalCatalogueSearch,
  type PortalHomeSearch,
  type PortalInboxSearch,
  type PortalKbSearch,
  type PortalProjectSearch,
  type PortalProjectsSearch,
  type PortalRequestsSearch,
  type PortalSignInSearch,
  parsePortalAnnouncementsSearch,
  parsePortalApprovalsSearch,
  parsePortalCatalogueSearch,
  parsePortalHomeSearch,
  parsePortalInboxSearch,
  parsePortalKbSearch,
  parsePortalProjectsSearch,
  parsePortalReleasesSearch,
  parsePortalRequestsSearch,
  parsePortalSignInSearch,
  portalCaseFilterQuery,
  portalProjectQuery,
} from "./portal-route-search";

export * from "./portal-route-search";
export const portalRouteBuilders = {
  /** Customer portal home, rooted on its separate origin. */
  portalHome: {
    path: "/" as const,
    build: (search: PortalHomeSearch = {}) =>
      `/${portalProjectQuery(portalCaseFilterQuery(parsePortalHomeSearch(search)), search)}`,
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
      if (resolved.redirect) query.set("redirect", resolved.redirect);
      return `/sign-in?${query.toString()}`;
    },
  },
  /** Portal knowledge base, host-root like every portal route. */
  portalKb: {
    path: "/kb" as const,
    build: (search: PortalKbSearch = {}) => {
      const resolved = parsePortalKbSearch(search);
      return `/kb${kbQuery({ q: resolved.q, category: resolved.category, project: resolved.project })}`;
    },
  },
  portalKbArticle: {
    path: "/kb/$id" as const,
    build: (params: { id: string }) => `/kb/${encodeURIComponent(params.id)}`,
  },
  portalReleases: {
    path: "/releases" as const,
    build: (search: PortalProjectSearch & { cursor?: string } = {}) => {
      const { cursor } = parsePortalReleasesSearch(search);
      const query = new URLSearchParams(cursor ? { cursor } : {});
      return `/releases${portalProjectQuery(query, search)}`;
    },
  },
  portalRelease: {
    path: "/releases/$id" as const,
    build: (params: { id: string }) =>
      `/releases/${encodeURIComponent(params.id)}`,
  },
  /** D7: announcements addressed to the customer's organisation. */
  portalAnnouncements: {
    path: "/announcements" as const,
    build: (search: PortalProjectSearch & { cursor?: string } = {}) => {
      const { cursor } = parsePortalAnnouncementsSearch(search);
      const query = new URLSearchParams(cursor ? { cursor } : {});
      return `/announcements${portalProjectQuery(query, search)}`;
    },
  },
  portalAnnouncement: {
    path: "/announcements/$id" as const,
    build: (params: { id: string }) =>
      `/announcements/${encodeURIComponent(params.id)}`,
  },
  portalCatalogue: {
    path: "/catalogue" as const,
    build: (search: PortalCatalogueSearch = {}) => {
      const resolved = parsePortalCatalogueSearch(search);
      const query = new URLSearchParams();
      if (resolved.q) query.set("q", resolved.q);
      if (resolved.key) query.set("key", resolved.key);
      return `/catalogue${portalProjectQuery(query, resolved)}`;
    },
  },
  portalInbox: {
    path: "/notifications" as const,
    build: (search: PortalInboxSearch = {}) => {
      const { filter } = parsePortalInboxSearch(search);
      const query = new URLSearchParams(filter ? { filter } : {});
      return `/notifications${portalProjectQuery(query, search)}`;
    },
  },
  portalRequests: {
    path: "/requests" as const,
    build: (search: PortalRequestsSearch = {}) => {
      const resolved = parsePortalRequestsSearch(search);
      const params = new URLSearchParams();
      if (resolved.view) params.set("view", resolved.view);
      for (const [key, value] of portalCaseFilterQuery(resolved))
        params.set(key, value);
      if (resolved.cursor) params.set("cursor", resolved.cursor);
      return `/requests${portalProjectQuery(params, search)}`;
    },
  },
  portalAccount: {
    path: "/account" as const,
    build: (search: PortalProjectSearch = {}) =>
      `/account${portalProjectQuery(new URLSearchParams(), search)}`,
  },
  /** UX-8 (CP-12): `/settings`, the sidebar's name for the account page, redirects to `/account`. */
  portalLegacySettings: { path: "/settings" as const },
  /** UX-8 (CP-12): `/knowledge-base` redirects to `/kb`. */
  portalLegacyKnowledgeBase: { path: "/knowledge-base" as const },
  portalApprovals: {
    path: "/approvals" as const,
    build: (search: PortalProjectSearch & { approval?: string } = {}) => {
      const { approval } = parsePortalApprovalsSearch(search);
      const query = new URLSearchParams(approval ? { approval } : {});
      return `/approvals${portalProjectQuery(query, search)}`;
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
  /** U-12 (D6): a request the team raised for the customer, opened by its key. */
  portalRequest: {
    path: "/requests/$ref" as const,
    build: (params: { ref: string }) =>
      `/requests/${encodeURIComponent(params.ref)}`,
  },
  /** S4c: the organisation's projects (`docs/screens.md` "Projects list"). */
  portalProjects: {
    path: "/projects" as const,
    build: (search: PortalProjectsSearch = {}) => {
      const { tab, q } = parsePortalProjectsSearch(search);
      const query = new URLSearchParams();
      if (tab) query.set("tab", tab);
      if (q) query.set("q", q);
      return `/projects${portalProjectQuery(query, search)}`;
    },
  },
  /**
   * S4c: one project's details (`docs/screens.md` "Project detail"). U-11: its cases table keeps
   * the dashboard's `scope`, `status` and `priority` filters in the URL.
   */
  portalProject: {
    path: "/projects/$projectKey" as const,
    build: (params: { projectKey: string }, search: PortalHomeSearch = {}) =>
      `/projects/${encodeURIComponent(params.projectKey)}${portalProjectQuery(portalCaseFilterQuery(parsePortalHomeSearch(search)), search)}`,
  },
};
export const routes = portalRouteBuilders;

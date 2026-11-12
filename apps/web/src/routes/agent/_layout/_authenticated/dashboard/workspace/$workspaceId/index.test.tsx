import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./index";

type RouterSessionContext = {
  session?: unknown;
};

const sessionIn = (activeOrganizationId: string | null) => ({
  session: { activeOrganizationId },
});

function buildRouter(initial: string, session?: unknown) {
  const root = createRootRouteWithContext<RouterSessionContext>()();
  const legacyWorkspaceIndex = createRoute({
    getParentRoute: () => root,
    path: "/dashboard/workspace/$workspaceId",
    beforeLoad: (args) => {
      Route.options.beforeLoad?.(args as never);
    },
  });
  const agentHome = createRoute({
    getParentRoute: () => root,
    path: "/agent",
  });
  return createRouter({
    routeTree: root.addChildren([legacyWorkspaceIndex, agentHome]),
    history: createMemoryHistory({ initialEntries: [initial] }),
    context: { session },
  });
}

describe("old projects list URL /dashboard/workspace/{id}", () => {
  it("redirects to /agent, replacing history, when it is the active workspace", async () => {
    const router = buildRouter("/dashboard/workspace/ws-1", sessionIn("ws-1"));
    await router.load();
    expect(router.history.location.href).toBe("/agent");
    expect(router.history.length).toBe(1);
  });

  it("preserves query parameters and #hash end-to-end when redirecting to /agent", async () => {
    const router = buildRouter(
      "/dashboard/workspace/ws-1?kind=project&recovery=1#pinned",
      sessionIn("ws-1"),
    );
    await router.load();
    expect(router.state.location.pathname).toBe("/agent");
    expect(router.state.location.searchStr).toBe("?kind=project&recovery=1");
    expect(router.state.location.hash).toBe("pinned");
    expect(router.history.location.href).toBe(
      "/agent?kind=project&recovery=1#pinned",
    );
    expect(router.history.length).toBe(1);
  });

  it("keeps showing the list of a workspace that is not the active one", async () => {
    const router = buildRouter(
      "/dashboard/workspace/ws-1?kind=project#pinned",
      sessionIn("ws-2"),
    );
    await router.load();
    expect(router.state.location.pathname).toBe("/dashboard/workspace/ws-1");
    expect(router.history.location.href).toBe(
      "/dashboard/workspace/ws-1?kind=project#pinned",
    );
  });

  it("never redirects when no workspace is active or the session is unknown", async () => {
    for (const session of [sessionIn(null), undefined, null]) {
      const router = buildRouter("/dashboard/workspace/ws-1", session);
      await router.load();
      expect(router.state.location.pathname).toBe("/dashboard/workspace/ws-1");
    }
  });
});

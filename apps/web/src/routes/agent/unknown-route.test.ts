import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.agent.gen";

function matchedIds(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient(), user: null },
  });
  return router
    .matchRoutes(router.latestLocation)
    .map((match) => match.routeId);
}

describe("agent unknown routes", () => {
  it("keeps an unknown agent path under the session guard", () => {
    expect(matchedIds("/agent/nothing-here")).toContain(
      "/_layout/_authenticated",
    );
  });

  it("keeps invitation acceptance on its public route", () => {
    expect(matchedIds("/invitation/accept/example").at(-1)).toBe(
      "/invitation/accept/$inviteId",
    );
  });
});

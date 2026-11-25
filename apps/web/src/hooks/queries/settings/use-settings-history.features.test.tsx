import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/query-client";
import type { HistoryTarget } from "@/query-client/settings-history-key";
import { useSettingsHistory } from "./use-settings-history";

// Only the HTTP layer is mocked: the real fetcher and the real hook check run on the response.
const get = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ client: { audit: { $get: get } } }));
vi.mock("@/fetchers/time-tracking", () => ({ getTimeSettings: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "u1" }, session: { id: "s1" } },
    }),
    getSession: async () => ({
      data: { user: { id: "u1" }, session: { id: "s1" } },
      error: null,
    }),
  },
}));

const response = (entityType: string, entityId: string, projectId = null) => ({
  ok: true,
  json: async () => ({
    entityType,
    entityId,
    workspaceId: "w1",
    projectId,
    lastChanged: null,
    rows: [
      {
        at: "2026-01-01T00:00:00Z",
        actor: { kind: "person", name: "A" },
        action: "feature_flag.changed",
        changedFields: ["featureFlag"],
      },
    ],
  }),
});

function Probe({ target }: { target: HistoryTarget }) {
  const { state } = useSettingsHistory(target);
  return <p data-testid="p">{state.status}</p>;
}

describe("Features History through the real fetcher and hook", () => {
  beforeEach(() => get.mockReset());
  afterEach(cleanup);
  it.each([
    [
      "workspace_features",
      "workspace",
      "w1",
      { kind: "workspace", workspaceId: "w1" },
      null,
    ],
    [
      "project_features",
      "project",
      "p1",
      { kind: "project", workspaceId: "w1", projectId: "p1" },
      "p1",
    ],
  ] as const)(
    "shows %s History for a valid %s response",
    async (type, entityType, id, scope, projectId) => {
      get.mockResolvedValue(response(entityType, id, projectId as never));
      render(
        <QueryClientProvider client={createQueryClient()}>
          <Probe target={{ kind: "entity", type, id, scope }} />
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("p").textContent).toBe("ready"),
      );
      expect(get).toHaveBeenCalledWith(
        { query: { entity_type: type, entity_id: id } },
        expect.anything(),
      );
    },
  );
});

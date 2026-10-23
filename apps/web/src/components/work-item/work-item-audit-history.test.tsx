import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemAuditHistory from "./work-item-audit-history";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  reconstruct: vi.fn(),
  states: vi.fn(),
  users: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      (options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => options?.[name] ?? "",
      ),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/get-work-item-audit-history", () => ({
  getWorkItemAuditHistory: mocks.history,
  getWorkItemReconstruction: mocks.reconstruct,
}));
vi.mock("@/fetchers/project/get-project-states", () => ({
  default: mocks.states,
}));
vi.mock("@/fetchers/workspace-user/get-active-workspace-users", () => ({
  default: mocks.users,
}));

const AT = "2026-10-23T08:15:30.123Z";

function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WorkItemAuditHistory
        workItemKey="HELP-1"
        workspaceId="ws-1"
        projectId="proj-1"
      />
    </QueryClientProvider>,
  );
}

async function openStateThen() {
  fireEvent.click(screen.getByText("Audit history"));
  fireEvent.click(await screen.findByText("State then"));
}

describe("WorkItemAuditHistory reconstruction", () => {
  beforeEach(() => {
    mocks.history.mockResolvedValue({
      rows: [
        {
          id: "a1",
          createdAt: AT,
          action: "work_item.transitioned",
          before: { stateId: "oldstate0000000000000001" },
          after: { stateId: "g5wmja2nnr3kcbz0grphl020" },
        },
      ],
    });
    mocks.states.mockResolvedValue([
      { id: "oldstate0000000000000001", name: "Open", position: 0 },
      { id: "g5wmja2nnr3kcbz0grphl020", name: "In Progress", position: 1 },
    ]);
    mocks.users.mockResolvedValue({ members: [] });
  });

  it("shows labelled values from the API shape, with null assignee as None", async () => {
    mocks.reconstruct.mockResolvedValue({
      key: "HELP-1",
      workItemId: "wi-1",
      at: AT,
      snapshot: {
        fields: {
          stateId: "g5wmja2nnr3kcbz0grphl020",
          assigneeId: null,
          priority: "high",
          title: "Printer is on fire",
        },
      },
    });
    renderHistory();
    await openStateThen();
    await waitFor(() => screen.getByText("In Progress"));
    expect(screen.getByText("Open \u2192 In Progress")).toBeTruthy();
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(mocks.reconstruct).toHaveBeenCalledWith("HELP-1", AT);
    expect(screen.queryByText(/No field values/)).toBeNull();
    expect(screen.getByText("Printer is on fire")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });
});

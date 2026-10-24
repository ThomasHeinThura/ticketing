import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CabTemplatePanel } from "./cab-template-panel";

const mocks = vi.hoisted(() => ({
  getCabTemplateStatus: vi.fn(),
  applyCabTemplate: vi.fn(),
}));

vi.mock("@/fetchers/service-management", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/service-management")>()),
  getCabTemplateStatus: mocks.getCabTemplateStatus,
  applyCabTemplate: mocks.applyCabTemplate,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.names ? `${key}:${options.names}` : key,
  }),
}));

const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];

function renderPanel(canManage = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CabTemplatePanel
        workspaceId="ws-1"
        canManage={canManage}
        projects={projects}
      />
    </QueryClientProvider>,
  );
}

const notApplied = {
  applied: false,
  workflowId: null,
  approvedStateTemplateId: null,
  adoptedProjectIds: [],
  changeTypeCount: 1,
};

beforeEach(() => {
  mocks.getCabTemplateStatus.mockResolvedValue(notApplied);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CabTemplatePanel (CH-2)", () => {
  it("applies nothing until a project is chosen and confirmed", async () => {
    mocks.applyCabTemplate.mockResolvedValue({ adoptedProjectIds: ["p2"] });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.cabTemplate.action",
      }),
    );
    const confirm = await screen.findByRole("button", {
      name: "settings:workflows.cabTemplate.confirm",
    });
    expect(confirm).toHaveProperty("disabled", true);
    expect(mocks.applyCabTemplate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.applyCabTemplate).toHaveBeenCalledWith("ws-1", ["p2"]),
    );
  });

  it("names the projects whose open changes would be stranded", async () => {
    const { CabTemplateStrandedError } = await import(
      "@/fetchers/service-management"
    );
    mocks.applyCabTemplate.mockRejectedValue(
      new CabTemplateStrandedError([{ id: "p2", name: "Beta" }]),
    );
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.cabTemplate.action",
      }),
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:workflows.cabTemplate.confirm",
      }),
    );
    expect(
      await screen.findByText("settings:workflows.cabTemplate.stranded:Beta"),
    ).toBeTruthy();
  });

  it("shows no action to someone who cannot manage workflows", async () => {
    renderPanel(false);
    await waitFor(() => expect(mocks.getCabTemplateStatus).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", {
        name: "settings:workflows.cabTemplate.action",
      }),
    ).toBeNull();
  });

  it("offers only the projects still without Approved once applied", async () => {
    mocks.getCabTemplateStatus.mockResolvedValue({
      ...notApplied,
      applied: true,
      adoptedProjectIds: ["p1"],
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings:workflows.cabTemplate.actionMore",
      }),
    );
    expect(await screen.findByRole("checkbox", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Alpha" })).toBeNull();
  });
});

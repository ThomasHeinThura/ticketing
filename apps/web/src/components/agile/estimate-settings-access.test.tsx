import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const historyMocks = vi.hoisted(() => ({
  update: vi.fn(),
  updatePolicy: vi.fn(),
  refresh: vi.fn(),
  session: { user: { id: "u1" }, session: { id: "s1" } } as {
    user: { id: string };
    session: { id: string };
  } | null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: historyMocks.session }) },
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({ id }: { id: string }) => (
    <div data-testid="estimate-history" data-id={id} />
  ),
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: historyMocks.refresh,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/agile", async (original) => ({
  ...(await original<typeof import("@/fetchers/agile")>()),
  getEstimates: async () => ({
    system: "points",
    points: [
      { key: "one", value: "1" },
      { key: "three", value: "3" },
    ],
    defaults: { points: ["1", "3"], categories: [], time: [] },
    incompletePolicy: "leave",
    canManage: false,
  }),
  updateEstimates: historyMocks.update,
  updateAgileSettings: historyMocks.updatePolicy,
}));

import { EstimateSettings } from "./estimate-settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  historyMocks.session = { user: { id: "u1" }, session: { id: "s1" } };
});
it.each(["viewer", "member", "lead"])(
  "shows estimates without mutation controls to a %s without management",
  async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EstimateSettings projectId="p1" projectKey="HELP" canManage={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("1, 3")).toBeInTheDocument();
    expect(screen.getByTestId("estimate-history")).toHaveAttribute(
      "data-id",
      "p1",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  },
);

const quiet = {
  fromSystem: "points",
  toSystem: "points",
  mapping: [],
  mappedItems: 0,
  clearedItems: 0,
  activeCycles: [],
};
function renderManaged() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EstimateSettings
        projectId="real-project-id"
        projectKey="HELP"
        canManage
      />
    </QueryClientProvider>,
  );
  return client;
}

it("refreshes only the real project History after an applied estimate change", async () => {
  historyMocks.update.mockImplementation(
    async (_key, input: { dryRun?: boolean }) => ({
      applied: !input.dryRun,
      preview: quiet,
    }),
  );
  const client = renderManaged();
  fireEvent.click(
    await screen.findByRole("button", { name: "estimates.review" }),
  );
  await waitFor(() => expect(historyMocks.update).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(historyMocks.refresh).toHaveBeenCalledOnce());
  expect(historyMocks.refresh).toHaveBeenCalledWith(
    client,
    [
      "settings-history",
      "project_estimates",
      "real-project-id",
      "agent",
      "u1",
      "s1",
    ],
    expect.any(Function),
  );
});

it("does not refresh History for no-op, refusal or absent session", async () => {
  historyMocks.update.mockImplementation(
    async (_key, _input: { dryRun?: boolean }) => ({
      applied: false,
      preview: quiet,
    }),
  );
  renderManaged();
  fireEvent.click(
    await screen.findByRole("button", { name: "estimates.review" }),
  );
  await waitFor(() => expect(historyMocks.update).toHaveBeenCalledTimes(2));
  expect(historyMocks.refresh).not.toHaveBeenCalled();
  cleanup();
  vi.clearAllMocks();
  historyMocks.session = null;
  historyMocks.update.mockResolvedValue({ applied: false, preview: quiet });
  renderManaged();
  await screen.findByRole("button", { name: "estimates.review" });
  expect(screen.queryByTestId("estimate-history")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "estimates.review" }));
  await waitFor(() => expect(historyMocks.update).toHaveBeenCalledTimes(2));
  expect(historyMocks.refresh).not.toHaveBeenCalled();
});

it("does not refresh History before confirmation or after failed apply", async () => {
  historyMocks.update.mockImplementation(
    async (_key, input: { dryRun?: boolean }) => {
      if (input.dryRun)
        return { applied: false, preview: { ...quiet, mappedItems: 1 } };
      throw new Error("refused");
    },
  );
  renderManaged();
  fireEvent.click(
    await screen.findByRole("button", { name: "estimates.review" }),
  );
  await waitFor(() => expect(historyMocks.update).toHaveBeenCalledOnce());
  expect(historyMocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
  expect(historyMocks.update).toHaveBeenCalledOnce();
  expect(historyMocks.refresh).not.toHaveBeenCalled();
  cleanup();
  vi.clearAllMocks();
  historyMocks.update.mockImplementation(
    async (_key, input: { dryRun?: boolean }) => {
      if (input.dryRun) return { applied: false, preview: quiet };
      throw new Error("refused");
    },
  );
  renderManaged();
  fireEvent.click(
    await screen.findByRole("button", { name: "estimates.review" }),
  );
  await waitFor(() => expect(historyMocks.update).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("refused")).toBeInTheDocument();
  expect(historyMocks.refresh).not.toHaveBeenCalled();
});

it("refreshes project History after a cycle policy save", async () => {
  historyMocks.updatePolicy.mockResolvedValue({});
  renderManaged();
  const radios = await screen.findAllByRole("radio");
  fireEvent.click(radios[1] as HTMLElement);
  await waitFor(() => expect(historyMocks.updatePolicy).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(historyMocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "project", "real-project-id", "agent", "u1", "s1"],
      expect.any(Function),
    ),
  );
  expect(historyMocks.refresh).toHaveBeenCalledWith(
    expect.anything(),
    [
      "settings-history",
      "project_estimates",
      "real-project-id",
      "agent",
      "u1",
      "s1",
    ],
    expect.any(Function),
  );
});

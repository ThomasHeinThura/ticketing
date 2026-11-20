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
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({
    target,
  }: {
    target: { type: string; id: string; scope: Record<string, string> };
  }) => (
    <div
      data-testid="estimate-history"
      data-type={target.type}
      data-id={target.id}
      data-scope={`${target.scope.workspaceId}:${target.scope.projectId}`}
    />
  ),
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
    expect(
      (await screen.findAllByTestId("estimate-history")).map((node) =>
        node.getAttribute("data-type"),
      ),
    ).toEqual(["project_estimates", "project"]);
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

/** The targets the global MutationCache would withdraw for the last mutation. */
const auditedTargets = (
  client: QueryClient,
  variables: unknown,
  result: unknown,
) =>
  client
    .getMutationCache()
    .getAll()
    .at(-1)
    ?.options.meta?.audits?.targets(variables as never, result as never);
const target = (type: string) => ({
  kind: "entity",
  type,
  id: "real-project-id",
  scope: { kind: "project", workspaceId: "w1", projectId: "real-project-id" },
});

it("declares the project estimates History after an applied estimate change only", async () => {
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
  await waitFor(() =>
    expect(auditedTargets(client, false, { applied: true })).toEqual([
      target("project_estimates"),
    ]),
  );
  expect(auditedTargets(client, false, { applied: false })).toEqual([]);
});

it("declares nothing for a failed apply", async () => {
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
});

it("declares project and estimates History after a cycle policy save", async () => {
  historyMocks.updatePolicy.mockResolvedValue({});
  const client = renderManaged();
  const radios = await screen.findAllByRole("radio");
  fireEvent.click(radios[1] as HTMLElement);
  await waitFor(() => expect(historyMocks.updatePolicy).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(auditedTargets(client, "x", {})).toEqual([
      target("project"),
      target("project_estimates"),
    ]),
  );
});

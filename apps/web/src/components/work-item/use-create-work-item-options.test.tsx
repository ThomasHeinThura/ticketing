import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  creationLabelCatalogue,
  useCreateWorkItemOptions,
} from "./use-create-work-item-options";

const mocks = vi.hoisted(() => ({
  states: vi.fn(),
  people: vi.fn(),
  global: vi.fn(),
  project: vi.fn(),
}));
vi.mock("@/fetchers/project/get-project-states", () => ({
  default: mocks.states,
}));
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: mocks.people,
}));
vi.mock("@/fetchers/label/get-label-by-workspace", () => ({
  default: mocks.global,
}));
vi.mock("@/fetchers/label/project-labels", () => ({
  getProjectLabels: mocks.project,
}));
const globalLabel = {
  id: "global",
  name: "Release",
  color: "teal",
  workspaceId: "workspace",
  taskId: null,
  projectId: null,
};
const projectLabel = {
  ...globalLabel,
  id: "project-label",
  projectId: "project",
};
function mount(canUpdate = true, canAssign = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useCreateWorkItemOptions({
        workspaceId: "workspace",
        projectId: "project",
        canUpdate,
        canAssign,
      }),
    { wrapper },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.states.mockResolvedValue([
    { id: "state", name: "Backlog", isDefault: true },
  ]);
  mocks.people.mockResolvedValue([
    { personId: "self", name: "Ada", roleName: "Agent", openWorkCount: 0 },
  ]);
  mocks.global.mockResolvedValue([globalLabel]);
  mocks.project.mockResolvedValue([projectLabel]);
});
afterEach(cleanup);
describe("canonical create option readers", () => {
  it("keeps only scoped catalogue labels, excludes task copies and foreign options, deduplicating by ID", () => {
    expect(
      creationLabelCatalogue(
        "workspace",
        "project",
        [
          globalLabel,
          { ...globalLabel, id: "copy", taskId: "task" },
          { ...globalLabel, id: "foreign", workspaceId: "foreign" },
          { ...globalLabel, id: "other-project", projectId: "other" },
        ],
        [
          projectLabel,
          projectLabel,
          { ...projectLabel, id: "foreign-project", projectId: "other" },
        ],
      ).map((label) => label.id),
    ).toEqual(["global", "project-label"]);
  });
  it("loads actual project/default/roster and both catalogue readers", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.labels).toHaveLength(2));
    expect(result.current.states[0]?.name).toBe("Backlog");
    expect(result.current.people[0]?.personId).toBe("self");
    expect(mocks.states).toHaveBeenCalledWith("project");
    expect(mocks.people).toHaveBeenCalledWith("project");
    expect(mocks.project).toHaveBeenCalledWith("project");
    expect(mocks.global).toHaveBeenCalledWith({ workspaceId: "workspace" });
  });
  it("does not request optional fields without their real capabilities", async () => {
    const { result } = mount(false, false);
    await waitFor(() => expect(result.current.states).toHaveLength(1));
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.global).not.toHaveBeenCalled();
    expect(mocks.project).not.toHaveBeenCalled();
  });
  it("uses the server's self-filtered roster when only update is held", async () => {
    const { result } = mount(true, false);
    await waitFor(() => expect(result.current.people).toHaveLength(1));
    expect(result.current.people.map((person) => person.personId)).toEqual([
      "self",
    ]);
  });
  it("reports failed catalogue/roster reads without inventing candidates", async () => {
    mocks.people.mockRejectedValue(new Error("Forbidden"));
    mocks.project.mockRejectedValue(new Error("Foreign project"));
    const { result } = mount();
    await waitFor(() =>
      expect(result.current.peopleError && result.current.labelsError).toBe(
        true,
      ),
    );
    expect(result.current.people).toEqual([]);
    expect(result.current.labels).toEqual([globalLabel]);
  });
});

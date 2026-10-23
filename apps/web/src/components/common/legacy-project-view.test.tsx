import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseProjectRouterSearch } from "@/lib/project-board-search";
import { buildProjectViewSwitchUrl } from "@/lib/project-layout-navigation";
import LegacyProjectView from "./legacy-project-view";

const mocks = vi.hoisted(() => ({
  project: {} as Record<string, unknown>,
  task: {} as Record<string, unknown>,
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: () => ({ search: mocks.search }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => mocks.project,
}));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => mocks.task,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./layout", () => ({
  default: {
    Content: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  },
}));

describe("authorized legacy navigation", () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.project = { isSuccess: false };
    mocks.task = {};
    mocks.search = { taskId: "private-task-id" };
  });
  afterEach(cleanup);
  it("does not navigate until the project is authorized", () => {
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("does not expose task IDs or links when project access fails", () => {
    mocks.project = { isError: true };
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    expect(screen.getByText("workItems:legacyView.unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-task-id");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("rejects URL workspace mismatches before navigation", () => {
    mocks.project = {
      isSuccess: true,
      data: { id: "p", workspaceId: "other", slug: "help" },
    };
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    expect(screen.getByText("workItems:legacyView.unavailable")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("opens the canonical board after the authorized read", async () => {
    mocks.project = {
      isSuccess: true,
      data: { id: "p", workspaceId: "w", slug: "help" },
    };
    mocks.search = {};
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: "/agent/projects/help/work?layout=board&sort=position&dir=asc",
        replace: true,
      }),
    );
  });
  it("keeps a failed legacy task read private and never guesses its key", () => {
    mocks.project = {
      isSuccess: true,
      data: { id: "p", workspaceId: "w", slug: "help" },
    };
    mocks.task = { isError: true };
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    expect(screen.getByText("workItems:legacyView.unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-task-id");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("requires an explicit action before dropping unsupported controls", async () => {
    mocks.project = {
      isSuccess: true,
      data: { id: "p", workspaceId: "w", slug: "help" },
    };
    mocks.search = { q: "private query" };
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    expect(
      screen.getByText("workItems:legacyView.unsupportedTitle"),
    ).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:legacyView.continue" }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.navigate.mock.calls[0][0].href).not.toContain("q=");
  });
  it("retains a verified legacy task's existing deep link", async () => {
    mocks.project = {
      isSuccess: true,
      data: { id: "p", workspaceId: "w", slug: "help" },
    };
    mocks.task = { isSuccess: true, data: { projectId: "p" } };
    render(<LegacyProjectView projectId="p" workspaceId="w" view="board" />);
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        href: "/dashboard/workspace/w/project/p/task/private-task-id",
        replace: true,
      }),
    );
  });
  it.each(["board", "list", "backlog"] as const)(
    "header %s switches keep unsupported filters until acknowledged",
    (view) => {
      const href = buildProjectViewSwitchUrl(
        view,
        { workspaceId: "w", projectId: "p", projectKey: "help" },
        "?q=original&status=active&taskId=HELP-4&filter=priority%3Ahigh",
      );
      const url = new URL(href, "https://test.invalid");
      expect(url.pathname).toBe(
        `/dashboard/workspace/w/project/p/${view === "backlog" ? "backlog" : "board"}`,
      );
      mocks.project = {
        isSuccess: true,
        data: { id: "p", workspaceId: "w", slug: "help" },
      };
      mocks.search = parseProjectRouterSearch(url.search);
      render(
        <LegacyProjectView
          projectId="p"
          workspaceId="w"
          view={view === "backlog" ? "backlog" : "board"}
        />,
      );
      expect(mocks.navigate).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "workItems:legacyView.continue" }),
      );
      const target = new URL(
        mocks.navigate.mock.calls[0][0].href,
        "https://test.invalid",
      );
      expect(target.searchParams.get("filter")).toBe("priority:high");
      expect(target.searchParams.get("item")).toBe("HELP-4");
      expect(target.searchParams.get("layout")).toBe(
        view === "list" ? "list" : "board",
      );
      expect(target.searchParams.has("q")).toBe(false);
    },
  );
});

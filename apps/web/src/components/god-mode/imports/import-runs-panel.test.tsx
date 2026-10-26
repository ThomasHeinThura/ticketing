import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), workspaces: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});
vi.mock("@/fetchers/god-mode/imports", () => ({
  listImportRuns: (...args: unknown[]) => mocks.list(...args),
}));
vi.mock("@/fetchers/workspace/get-workspaces", () => ({
  default: (...args: unknown[]) => mocks.workspaces(...args),
}));
vi.mock("./import-run-create-dialog", () => ({
  ImportRunCreateDialog: () => null,
}));
vi.mock("./wizard/connect-step", () => ({
  ConnectStep: ({
    workspaceId,
    onCreated,
    onCancel,
  }: {
    workspaceId: string;
    onCreated: (run: { id: string; workspaceId: string }) => void;
    onCancel: () => void;
  }) => (
    <section aria-label="Connect step">
      {workspaceId}
      <Button onClick={() => onCreated({ id: "run-9", workspaceId })}>
        finish connect
      </Button>
      <Button onClick={onCancel}>cancel connect</Button>
    </section>
  ),
}));

import { ImportRunsPanel } from "./import-runs-panel";

beforeEach(() => {
  mocks.workspaces.mockReset().mockResolvedValue([
    { id: "workspace-1", name: "Operations" },
    { id: "workspace-2", name: "Research" },
  ]);
  mocks.list.mockReset().mockResolvedValue({
    runs: [
      {
        id: "run-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        pluginId: "import.mcp",
        sourceRef: "mcp:source-1",
        profileId: null,
        state: "running",
        stats: { processed: 3, created: 2 },
        log: [],
        version: 2,
        nextCursor: null,
        lastCommittedChunk: 0,
        createdAt: "2026-10-26T00:00:00.000Z",
        updatedAt: "2026-10-26T00:01:00.000Z",
      },
    ],
    nextCursor: null,
  });
});
afterEach(cleanup);

describe("ImportRunsPanel", () => {
  it("shows real workspace-filtered run history and opens a selected run", async () => {
    const onOpenRun = vi.fn();
    const onWorkspaceChange = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunsPanel
          onOpenRun={onOpenRun}
          onWorkspaceChange={onWorkspaceChange}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("mcp:source-1")).toBeInTheDocument();
    expect(screen.getByText("states.running")).toBeInTheDocument();
    expect(screen.getByText(/created: 2/u)).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      cursor: undefined,
      limit: 50,
    });

    fireEvent.click(screen.getByRole("button", { name: "openRun" }));
    await waitFor(() => {
      expect(onWorkspaceChange).toHaveBeenCalledWith("workspace-1");
      expect(onOpenRun).toHaveBeenCalledWith("run-1", "workspace-1");
    });
  });

  it("keeps a valid URL workspace instead of resetting to the first workspace", async () => {
    const onWorkspaceChange = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunsPanel
          workspaceId="workspace-2"
          onOpenRun={vi.fn()}
          onWorkspaceChange={onWorkspaceChange}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith({
        workspaceId: "workspace-2",
        cursor: undefined,
        limit: 50,
      });
    });
    expect(onWorkspaceChange).not.toHaveBeenCalled();
  });

  it("replaces an inaccessible URL workspace with the first accessible workspace", async () => {
    const onWorkspaceChange = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunsPanel
          workspaceId="not-accessible"
          onOpenRun={vi.fn()}
          onWorkspaceChange={onWorkspaceChange}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(onWorkspaceChange).toHaveBeenCalledWith("workspace-1");
      expect(mocks.list).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        cursor: undefined,
        limit: 50,
      });
    });
  });

  it("starts the wizard from New import and opens the new run at the discover step", async () => {
    const onNewImport = vi.fn();
    const onOpenRun = vi.fn();
    const onCloseWizard = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <ImportRunsPanel
          workspaceId="workspace-1"
          onOpenRun={onOpenRun}
          onWorkspaceChange={vi.fn()}
          onNewImport={onNewImport}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "wizard.newImport" }),
    );
    expect(onNewImport).toHaveBeenCalled();

    view.rerender(
      <QueryClientProvider client={client}>
        <ImportRunsPanel
          workspaceId="workspace-1"
          step="connect"
          onOpenRun={onOpenRun}
          onWorkspaceChange={vi.fn()}
          onNewImport={onNewImport}
          onCloseWizard={onCloseWizard}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Connect step")).toBeInTheDocument();
    expect(screen.queryByText("mcp:source-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "finish connect" }));
    expect(onOpenRun).toHaveBeenCalledWith("run-9", "workspace-1", "discover");
    fireEvent.click(screen.getByRole("button", { name: "cancel connect" }));
    expect(onCloseWizard).toHaveBeenCalled();
  });
});

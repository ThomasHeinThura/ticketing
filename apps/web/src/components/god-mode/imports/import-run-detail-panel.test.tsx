import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  report: vi.fn(),
  engine: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/fetchers/god-mode/imports", () => ({
  getImportRun: (...args: unknown[]) => mocks.run(...args),
  getImportReport: (...args: unknown[]) => mocks.report(...args),
  getEngineImportRun: (...args: unknown[]) => mocks.engine(...args),
}));
vi.mock("./wizard/import-wizard", () => ({
  ImportWizard: ({ runId, step }: { runId: string; step?: string }) => (
    <section aria-label="Import wizard">
      wizard {runId} {step ?? "no-step"}
    </section>
  ),
}));

import { ImportRunDetailPanel } from "./import-run-detail-panel";

beforeEach(() => {
  // MCP runs have no source connection, so the engine endpoint answers 404 for them.
  mocks.engine.mockReset().mockRejectedValue(new HttpError(404, "not found"));
  mocks.run.mockReset().mockResolvedValue({
    id: "run-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    pluginId: "import.mcp",
    sourceRef: "mcp:source-1",
    profileId: null,
    state: "completed",
    stats: { processed: 3, created: 2, rejected: 1 },
    log: [
      {
        code: "chunk_committed",
        at: "2026-10-26T00:01:00.000Z",
        chunkId: "chunk-1",
      },
    ],
    version: 2,
    nextCursor: null,
    lastCommittedChunk: 0,
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:01:00.000Z",
  });
  mocks.report.mockReset().mockResolvedValue({
    runId: "run-1",
    counts: { processed: 3, created: 2, rejected: 1 },
    log: [],
    chunks: [
      {
        sequence: 0,
        chunkId: "chunk-1",
        state: "committed",
        recordCount: 3,
        counts: { created: 2, rejected: 1 },
        rejectionCodes: { invalid_target_record: 1 },
        createdAt: "2026-10-26T00:01:00.000Z",
        committedAt: "2026-10-26T00:02:00.000Z",
      },
    ],
  });
});
afterEach(cleanup);

describe("ImportRunDetailPanel", () => {
  it("renders only safe persisted run, fixed-code log, and reconciliation fields", async () => {
    const onWorkspaceResolved = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunDetailPanel
          runId="run-1"
          onWorkspaceResolved={onWorkspaceResolved}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("mcp:source-1")).toBeInTheDocument();
    expect(screen.getByText("states.completed")).toBeInTheDocument();
    expect(screen.getByText("logCodes.chunk_committed")).toBeInTheDocument();
    expect(
      screen.getByText("rejectionCodes.invalid_target_record: 1"),
    ).toBeInTheDocument();
    expect(mocks.run).toHaveBeenCalledWith("run-1");
    expect(mocks.report).toHaveBeenCalledWith("run-1");
    expect(onWorkspaceResolved).toHaveBeenCalledWith("workspace-1");
    expect(
      screen.queryByText(/raw.source.record|credential|password/iu),
    ).not.toBeInTheDocument();
  });

  it("opens the import wizard at the requested step for an engine run", async () => {
    mocks.engine.mockResolvedValue({
      id: "run-1",
      workspaceId: "workspace-1",
      state: "queued",
      phase: "created",
      approval: { required: false, approved: false, pendingActionId: null },
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunDetailPanel runId="run-1" step="mapping" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("wizard run-1 mapping")).toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("shows an error, not the MCP detail, when the engine run fails for another reason", async () => {
    mocks.engine.mockRejectedValue(new HttpError(500, "boom"));
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunDetailPanel runId="run-1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("detailLoadErrorTitle")).toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("shows the forbidden message when the engine endpoint refuses access", async () => {
    mocks.engine.mockRejectedValue(new HttpError(403, "denied"));
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImportRunDetailPanel runId="run-1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("forbiddenTitle")).toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

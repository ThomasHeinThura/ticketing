import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listQueues: vi.fn(),
  createQueue: vi.fn(),
  getQueue: vi.fn(),
  updateQueue: vi.fn(),
  getTeams: vi.fn(),
  translate: vi.fn((key: string) => key),
}));
vi.mock("@/fetchers/intake-queues", () => ({
  listIntakeQueues: (...args: unknown[]) => mocks.listQueues(...args),
  createIntakeQueue: (...args: unknown[]) => mocks.createQueue(...args),
  getIntakeQueue: (...args: unknown[]) => mocks.getQueue(...args),
  updateIntakeQueue: (...args: unknown[]) => mocks.updateQueue(...args),
}));
vi.mock("@/fetchers/saved-views", () => ({
  getShareableViewTeams: (...args: unknown[]) => mocks.getTeams(...args),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "viewer-1" } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => mocks.translate(key) }),
}));

import { IntakeQueuePicker } from "./queue-picker";

const saved = {
  id: "pair-1",
  workspaceId: "workspace-1",
  name: "Saved support",
  visibility: "private" as const,
  sharedWithTeamId: null,
  versions: { submission: 1, workItem: 1 },
};

function renderPicker(
  input: {
    canCreate?: boolean;
    canShare?: boolean;
    queueId?: string;
    currentSubmissionQuery?: Record<string, unknown>;
    currentWorkItemQuery?: Record<string, unknown>;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onSelect = vi.fn();
  render(
    <IntakeQueuePicker
      workspaceId="workspace-1"
      queueId={input.queueId}
      canCreate={input.canCreate ?? false}
      canShare={input.canShare ?? false}
      currentSubmissionQuery={input.currentSubmissionQuery}
      currentWorkItemQuery={input.currentWorkItemQuery}
      onSelect={onSelect}
    />,
    { wrapper },
  );
  return { onSelect };
}

beforeEach(() => {
  mocks.translate.mockReset().mockImplementation((key) => key);
  mocks.listQueues.mockReset().mockResolvedValue([saved]);
  mocks.createQueue.mockReset().mockResolvedValue({ ...saved, id: "pair-2" });
  mocks.getQueue.mockReset().mockResolvedValue({
    ...saved,
    createdBy: "viewer-1",
    submissionView: {
      id: "submission-view",
      query: {
        entity: "submission",
        filter: { state: "accepted", requestTypeKey: "access" },
      },
      updatedAt: "2026-10-25T00:00:00Z",
    },
    workItemView: {
      id: "work-item-view",
      query: { entity: "work_item", filter: { state: "active" } },
      updatedAt: "2026-10-25T00:00:00Z",
    },
  });
  mocks.updateQueue
    .mockReset()
    .mockResolvedValue({ ...saved, name: "Updated support" });
  mocks.getTeams.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("IntakeQueuePicker", () => {
  it("renders human labels instead of current and visibility value ids", async () => {
    renderPicker({ canCreate: true, queueId: "pair-1" });
    const picker = await screen.findByRole("button", {
      name: "queue.choose",
    });
    await waitFor(() => expect(picker).toHaveTextContent("Saved support"));
    expect(picker).not.toHaveTextContent("pair-1");

    fireEvent.click(screen.getByRole("button", { name: "queue.edit" }));
    const visibility = await screen.findByLabelText("queue.visibility");
    expect(visibility).toHaveTextContent(/^queue\.private$/);
  });

  it("uses the registered shared close and cancel translations", async () => {
    mocks.translate.mockImplementation((key) => {
      if (key === "common:actions.cancel") return "Cancel";
      if (key === "common:actions.close") return "Close dialog";
      return key;
    });
    renderPicker({ canCreate: true, queueId: "pair-1" });
    fireEvent.click(await screen.findByRole("button", { name: "queue.edit" }));

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeTruthy();
  });

  it("shows reachable saved queues and reports the selected pair", async () => {
    const { onSelect } = renderPicker();
    await screen.findByRole("button", { name: "queue.choose" });
    fireEvent.click(screen.getByRole("button", { name: "queue.choose" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Saved support" }),
    );
    expect(onSelect).toHaveBeenCalledWith("pair-1");
    expect(mocks.listQueues).toHaveBeenCalledWith("workspace-1");
  });

  it("creates a private pair from the current two query definitions", async () => {
    const { onSelect } = renderPicker({
      canCreate: true,
      currentSubmissionQuery: {
        entity: "submission",
        filter: { state: "new" },
      },
      currentWorkItemQuery: { entity: "work_item" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "queue.save" }));
    fireEvent.change(screen.getByLabelText("queue.name"), {
      target: { value: "My current queue" },
    });
    const saveButtons = await screen.findAllByRole("button", {
      name: "queue.save",
    });
    fireEvent.click(saveButtons.at(-1)!);
    await waitFor(() => {
      expect(mocks.createQueue).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "My current queue",
        visibility: "private",
        submissionQuery: { entity: "submission", filter: { state: "new" } },
        workItemQuery: { entity: "work_item" },
      });
    });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("pair-2"));
  });

  it("creates entity-only definitions when no URL filters override the current queue", async () => {
    renderPicker({ canCreate: true });
    fireEvent.click(await screen.findByRole("button", { name: "queue.save" }));
    fireEvent.change(screen.getByLabelText("queue.name"), {
      target: { value: "Unfiltered pair" },
    });
    const saveButtons = await screen.findAllByRole("button", {
      name: "queue.save",
    });
    fireEvent.click(saveButtons.at(-1)!);
    await waitFor(() => {
      expect(mocks.createQueue).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        name: "Unfiltered pair",
        visibility: "private",
        submissionQuery: { entity: "submission" },
        workItemQuery: { entity: "work_item" },
      });
    });
  });

  it("updates both saved query definitions with the pair versions", async () => {
    renderPicker({
      canCreate: true,
      queueId: "pair-1",
      currentSubmissionQuery: {
        entity: "submission",
        filter: { state: "new" },
      },
      currentWorkItemQuery: { entity: "work_item" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "queue.edit" }));
    const name = await screen.findByLabelText("queue.name");
    await waitFor(() => expect(name).toHaveValue("Saved support"));
    fireEvent.change(name, { target: { value: "Updated support" } });
    fireEvent.click(screen.getByRole("button", { name: "queue.update" }));
    await waitFor(() => {
      expect(mocks.updateQueue).toHaveBeenCalledWith({
        id: "pair-1",
        workspaceId: "workspace-1",
        expectedVersions: { submission: 1, workItem: 1 },
        name: "Updated support",
        visibility: "private",
        sharedWithTeamId: null,
        submissionQuery: {
          entity: "submission",
          filter: { state: "new", requestTypeKey: "access" },
        },
        workItemQuery: {
          entity: "work_item",
          filter: { state: "active" },
        },
      });
    });
  });

  it("renames a queue without replacing persisted filters when there are no URL overrides", async () => {
    renderPicker({ canCreate: true, queueId: "pair-1" });
    fireEvent.click(await screen.findByRole("button", { name: "queue.edit" }));
    const name = await screen.findByLabelText("queue.name");
    await waitFor(() => expect(name).toHaveValue("Saved support"));
    fireEvent.change(name, { target: { value: "Renamed only" } });
    fireEvent.click(screen.getByRole("button", { name: "queue.update" }));
    await waitFor(() => {
      expect(mocks.updateQueue).toHaveBeenCalledWith({
        id: "pair-1",
        workspaceId: "workspace-1",
        expectedVersions: { submission: 1, workItem: 1 },
        name: "Renamed only",
        visibility: "private",
        sharedWithTeamId: null,
      });
    });
  });
});

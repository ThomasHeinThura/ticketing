import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { WorkItemFeedbackProvider } from "./work-item-feedback";
import WorkItemTitle, { TITLE_SAVE_DELAY_MS } from "./work-item-title";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => true }),
}));

function item(overrides: Partial<WorkItemDetailRow> = {}) {
  return {
    key: "HELP-7",
    number: 7,
    projectId: "p1",
    workspaceId: "w1",
    title: "Printer jammed",
    description: null,
    stateName: "To do",
    priority: "high",
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    version: 4,
    unavailableFields: [],
    ...overrides,
  } as unknown as WorkItemDetailRow;
}

function setup(current = item(), latest?: WorkItemDetailRow) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // What a refetch of the detail returns (someone else's newer version).
  if (latest) {
    client.setQueryDefaults(["work-items", "detail", current.key], {
      queryFn: () => latest,
    });
  }
  client.setQueryData(["work-items", "detail", current.key], current);
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <WorkItemFeedbackProvider>{node}</WorkItemFeedbackProvider>
    </QueryClientProvider>
  );
  const view = render(
    wrap(<WorkItemTitle item={current} onAccessLost={vi.fn()} />),
  );
  return {
    client,
    view,
    rerender: (next: WorkItemDetailRow) =>
      view.rerender(wrap(<WorkItemTitle item={next} onAccessLost={vi.fn()} />)),
    input: () =>
      screen.getByLabelText(
        "workItems:properties.titleLabel",
      ) as HTMLInputElement,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.update.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("WorkItemTitle", () => {
  it("persists a return to the original title while an earlier edit is saving", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.update
      .mockImplementationOnce(
        () => new Promise((resolve) => (answer = resolve)),
      )
      .mockResolvedValueOnce({
        key: "HELP-7",
        version: 6,
        title: "Printer jammed",
      });
    const { input } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Changed" } });
    fireEvent.blur(input());
    await flushPromises();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Printer jammed" } });
    fireEvent.blur(input());
    await act(async () => {
      answer({ key: "HELP-7", version: 5, title: "Changed" });
    });
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
      title: "Printer jammed",
      version: 5,
    });
  });

  it("saves once after the pause, with the cached version", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const { input } = setup();
    fireEvent.change(input(), { target: { value: "Printer jam" } });
    fireEvent.change(input(), { target: { value: "Printer jammed again" } });
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(TITLE_SAVE_DELAY_MS);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      title: "Printer jammed again",
    });
  });

  it("flushes a pending save when it unmounts inside the pause", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const { input, view } = setup();
    fireEvent.change(input(), { target: { value: "Closed the pane fast" } });
    view.unmount();
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      title: "Closed the pane fast",
    });
  });

  it("flushes a pending save on blur", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const { input } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Tabbed away" } });
    fireEvent.blur(input());
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("does not 409 against itself on two quick saves", async () => {
    mocks.update
      .mockResolvedValueOnce({ key: "HELP-7", version: 5, title: "One" })
      .mockResolvedValueOnce({ key: "HELP-7", version: 6, title: "Two" });
    const { input } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "One" } });
    fireEvent.blur(input());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Two" } });
    fireEvent.blur(input());
    await flushPromises();
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ version: 4 });
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ version: 5 });
  });

  it("returns to the server's title on a version conflict and says so", async () => {
    mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
    const { input } = setup(item(), item({ title: "Their title", version: 5 }));
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "My title" } });
    fireEvent.blur(input());
    await vi.waitFor(() => expect(input().value).toBe("Their title"));
    expect(screen.queryByText("workItems:properties.unsaved")).toBeNull();
  });

  it("keeps the text after another failure, marks it unsaved, and retries on blur", async () => {
    mocks.update
      .mockRejectedValueOnce(new HttpError(500, "boom"))
      .mockResolvedValueOnce({ key: "HELP-7", version: 5 });
    const { input } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Keep me" } });
    fireEvent.blur(input());
    expect(
      await screen.findByText("workItems:properties.unsaved"),
    ).toBeInTheDocument();
    expect(input().value).toBe("Keep me");
    fireEvent.focus(input());
    fireEvent.blur(input());
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(screen.queryByText("workItems:properties.unsaved")).toBeNull(),
    );
  });

  it("does not overwrite text typed while a save was in flight", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    const { input, rerender } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "First" } });
    await act(async () => {
      vi.advanceTimersByTime(TITLE_SAVE_DELAY_MS);
    });
    fireEvent.change(input(), { target: { value: "First and more" } });
    rerender(item({ title: "First", version: 5 }));
    expect(input().value).toBe("First and more");
  });

  it("does not send the same title again when the field blurs while its save is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.update.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { input } = setup();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Paused then left" } });
    await act(async () => {
      vi.advanceTimersByTime(TITLE_SAVE_DELAY_MS);
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    fireEvent.blur(input());
    await flushPromises();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ key: "HELP-7", version: 5, title: "Paused then left" });
    });
    // Settled: a later change saves normally.
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Changed again" } });
    fireEvent.blur(input());
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
  });
});

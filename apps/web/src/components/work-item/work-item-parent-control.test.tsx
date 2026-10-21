import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { WorkItemFeedbackProvider } from "./work-item-feedback";
import WorkItemParentControl from "./work-item-parent-control";

const fake = vi.hoisted(() => ({
  canUpdate: true,
  candidate: vi.fn(),
  save: vi.fn(),
  permission: vi.fn(),
  refetch: vi.fn(),
  error: null as unknown,
  ancestors: [] as { key: string }[],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/work-item/set-work-item-parent", () => ({
  getParentCandidate: fake.candidate,
  setWorkItemParent: fake.save,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    fake.permission(...args);
    return { canUpdateTasks: () => fake.canUpdate };
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-hierarchy-children", () => ({
  useGetHierarchyChildren: () => ({
    data: { pages: [{ ancestors: fake.ancestors }] },
    isError: Boolean(fake.error),
    error: fake.error,
    refetch: fake.refetch,
  }),
}));
const item = {
  key: "OPS-1",
  workspaceId: "ws",
  projectId: "project",
  version: 7,
  parentId: null,
  unavailableFields: [],
} as unknown as WorkItemDetailRow;
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["work-items", "detail", item.key], item);
  const onAccessLost = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <WorkItemFeedbackProvider>
        <WorkItemParentControl
          item={item}
          compact={false}
          onAccessLost={onAccessLost}
        />
      </WorkItemFeedbackProvider>
    </QueryClientProvider>,
  );
  return { client, onAccessLost };
}
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "workItems:parent.label" }),
  );
}
function typeKey(key: string) {
  fireEvent.change(
    screen.getByRole("textbox", { name: "workItems:parent.key" }),
    { target: { value: key } },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.canUpdate = true;
  fake.error = null;
  fake.ancestors = [];
  fake.candidate.mockReset().mockResolvedValue({
    key: "OPS-2",
    title: "Candidate",
    projectId: "project",
  });
  fake.save.mockReset().mockResolvedValue({ parentId: "parent", version: 9 });
  fake.refetch.mockResolvedValue({});
});
describe("Kaneo parent control", () => {
  it("looks up a real mixed-case hyphenated key without rewriting it", async () => {
    fake.candidate.mockResolvedValue({
      key: "service-Team-2",
      title: "Candidate",
      projectId: "project",
    });
    setup();
    open();
    typeKey("service-Team-2");
    await screen.findByText("service-Team-2 · Candidate");
    expect(fake.candidate).toHaveBeenCalledWith(
      "service-Team-2",
      expect.any(AbortSignal),
    );
  });
  it("uses project-scoped authority and keeps read-only viewers out of editing", () => {
    fake.canUpdate = false;
    setup();
    expect(fake.permission).toHaveBeenCalledWith("ws", "project");
    expect(
      screen.getByRole("button", { name: "workItems:parent.label" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("asserts the current queued version rather than an older render", async () => {
    const { client } = setup();
    open();
    typeKey("OPS-2");
    await screen.findByText("OPS-2 · Candidate");
    client.setQueryData(["work-items", "detail", item.key], {
      ...item,
      version: 8,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:parent.set" }),
    );
    await waitFor(() =>
      expect(fake.save).toHaveBeenCalledWith({
        key: "OPS-1",
        version: 8,
        parentKey: "OPS-2",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
    );
  });
  it("rejects a cross-project candidate without displaying its title", async () => {
    fake.candidate.mockResolvedValue({
      key: "OTHER-2",
      title: "Private other project",
      projectId: "other",
    });
    setup();
    open();
    typeKey("OTHER-2");
    await screen.findByRole("alert");
    expect(screen.queryByText(/Private other project/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "workItems:parent.set" }),
    ).toBeDisabled();
  });
  it("does not look up self or malformed keys", () => {
    setup();
    open();
    typeKey("OPS-1");
    typeKey("../invalid");
    expect(fake.candidate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "workItems:parent.set" }),
    ).toBeDisabled();
  });
  it("keeps the subject visible when the candidate is unavailable", async () => {
    fake.candidate.mockRejectedValue(new HttpError(404, "Not found"));
    const { onAccessLost } = setup();
    open();
    typeKey("OPS-2");
    await screen.findByRole("alert");
    expect(onAccessLost).not.toHaveBeenCalled();
  });
  it("retains the draft and exposes a version conflict instead of replaying it", async () => {
    fake.save.mockRejectedValue(new WorkItemVersionConflictError(7, 8));
    setup();
    open();
    typeKey("OPS-2");
    await screen.findByText("OPS-2 · Candidate");
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:parent.set" }),
    );
    await screen.findByText("workItems:parent.conflict");
    expect(screen.getByRole("textbox")).toHaveValue("OPS-2");
    expect(fake.save).toHaveBeenCalledTimes(1);
  });
  it("detaches with the same versioned mutation path", async () => {
    fake.ancestors = [{ key: "OPS-2" }];
    setup();
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:parent.remove" }),
    );
    await waitFor(() =>
      expect(fake.save).toHaveBeenCalledWith({
        key: "OPS-1",
        version: 7,
        parentKey: null,
      }),
    );
  });
  it("masks cached parent context after subject access is lost", async () => {
    fake.ancestors = [{ key: "OPS-900" }];
    fake.error = new HttpError(404, "Not found");
    const { onAccessLost } = setup();
    await waitFor(() => expect(onAccessLost).toHaveBeenCalled());
    expect(screen.queryByText("OPS-900")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "workItems:parent.label" }),
    ).toBeDisabled();
  });
});

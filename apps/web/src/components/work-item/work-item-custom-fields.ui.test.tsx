import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemCustomFields from "./work-item-custom-fields";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), canEdit: true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => mocks.canEdit }),
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("./work-item-save", () => ({
  useSaveWorkItemFields: () => ({ mutate: mocks.mutate, isPending: false }),
  useRefreshWorkItem: () => vi.fn(),
}));

const item: WorkItemDetailRow = {
  id: "item-1",
  key: "QA-1",
  number: 1,
  projectId: "project-1",
  workspaceId: "workspace-1",
  typeId: "type-1",
  title: "Synthetic datetime test",
  description: null,
  stateId: "state-1",
  stateName: "To do",
  stateCategory: "unstarted",
  priority: null,
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: "1",
  customerVisibility: "private",
  startDate: null,
  dueDate: null,
  archivedAt: null,
  deletedAt: null,
  version: 7,
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  defaultCommentVisibility: "internal",
  importProvenance: [],
  unavailableFields: [],
  customFields: [
    {
      id: "field-1",
      key: "review_at",
      name: "Review at",
      format: "datetime",
      sectionId: "section-1",
      sectionName: "Details",
      options: [],
      helpText: null,
      required: false,
      shown: true,
      customerVisible: false,
      visibilityCondition: null,
      value: "2026-10-30T03:15:00.000Z",
    },
  ],
};

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.canEdit = true;
  vi.stubEnv("TZ", "Asia/Yangon");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("commits one complete datetime choice without relying on a trigger blur", () => {
  render(<WorkItemCustomFields item={item} onAccessLost={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Review at" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Hour" }));
  const option = screen.getByRole("option", { name: "18" });
  fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
  fireEvent.click(option);
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
    customFields: { review_at: "2026-10-30T12:15:00.000Z" },
  });
});

it("clears a datetime once and leaves a cancelled draft unsaved", () => {
  render(<WorkItemCustomFields item={item} onAccessLost={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Review at" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review at" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
    customFields: { review_at: null },
  });
});

it("does not expose the editor without update permission", () => {
  mocks.canEdit = false;
  render(<WorkItemCustomFields item={item} onAccessLost={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Review at" })).toBeNull();
  expect(mocks.mutate).not.toHaveBeenCalled();
});

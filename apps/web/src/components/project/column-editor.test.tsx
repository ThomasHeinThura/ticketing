import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ColumnEditor from "./column-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

const columns = [
  { id: "c1", name: "Backlog", slug: "backlog", isFinal: false, icon: null },
  { id: "c2", name: "Done", slug: "done", isFinal: true, icon: null },
];

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: columns, isLoading: false }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageProjects: () => true }),
}));

vi.mock("@/hooks/mutations/column/use-create-column", () => ({
  useCreateColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-delete-column", () => ({
  useDeleteColumn: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-reorder-columns", () => ({
  useReorderColumns: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/column/use-update-column", () => ({
  useUpdateColumn: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(cleanup);

describe("ColumnEditor accessibility", () => {
  it("renders the column rows as a real list", () => {
    render(<ColumnEditor projectId="project-1" />);

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("names every per-column control and the new-column controls", () => {
    render(<ColumnEditor projectId="project-1" />);

    expect(
      screen.getByRole("textbox", { name: "Name of column Backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete column Backlog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete column Done" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "New column name..." }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Pick column icon" }),
    ).toHaveLength(3);
  });
});

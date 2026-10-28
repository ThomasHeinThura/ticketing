import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import SortControl from "./sort-control";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

describe("SortControl", () => {
  it("translates the active field label directly in the synchronous trigger", () => {
    render(
      <SortControl
        sort={{ field: "createdAt", direction: "desc" }}
        onSortChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: translate("tasks:sort.fields.createdAt"),
      }),
    ).toBeInTheDocument();
  });

  it("resets a restricted active field to the available number field", async () => {
    const onSortChange = vi.fn();
    render(
      <SortControl
        sort={{ field: "title", direction: "desc" }}
        fields={["title", "number"]}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Title" }));
    expect(
      await screen.findByRole("menuitem", {
        name: translate("tasks:sort.fields.number"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", {
        name: translate("tasks:sort.fields.position"),
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Title/ }));

    expect(onSortChange).toHaveBeenCalledWith({
      field: "number",
      direction: "asc",
    });
  });
});

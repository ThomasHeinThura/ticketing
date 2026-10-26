import { Label } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { CustomFieldValueInput } from "./custom-field-value-input";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("CustomFieldValueInput user value labels", () => {
  it("uses the unavailable wording for an unnamed user and never exposes its ID", () => {
    render(
      <>
        <Label htmlFor="owner">Owner</Label>
        <CustomFieldValueInput
          id="owner"
          field={{ name: "Owner", format: "user", options: [] }}
          value="private-person-id"
          people={[{ personId: "private-person-id", name: null }]}
          onChange={vi.fn()}
        />
      </>,
    );

    const trigger = screen.getByRole("combobox", { name: "Owner" });
    expect(trigger).toHaveTextContent("(not on this project)");
    fireEvent.click(trigger);
    expect(
      screen.getByRole("option", { name: "(not on this project)" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("private-person-id")).toBeNull();
  });

  it("shows unavailable multi-user selections and preserves their IDs when another person is selected", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <>
        <Label htmlFor="reviewers">Reviewers</Label>
        <CustomFieldValueInput
          id="reviewers"
          field={{ name: "Reviewers", format: "multi_user", options: [] }}
          value={["private-person-id"]}
          people={[{ personId: "person-new", name: "Alex" }]}
          onChange={onChange}
        />
      </>,
    );

    expect(screen.getByText("(not on this project)")).toBeInTheDocument();
    expect(screen.queryByText("private-person-id")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reviewers" }));
    fireEvent.click(screen.getByRole("button", { name: "Alex" }));
    expect(onChange).toHaveBeenCalledWith(["private-person-id", "person-new"]);
    rerender(
      <>
        <Label htmlFor="reviewers">Reviewers</Label>
        <CustomFieldValueInput
          id="reviewers"
          field={{ name: "Reviewers", format: "multi_user", options: [] }}
          value={["private-person-id", "person-new"]}
          people={[{ personId: "person-new", name: "Alex" }]}
          onChange={onChange}
        />
      </>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "(not on this project)" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(["person-new"]);
  });
});

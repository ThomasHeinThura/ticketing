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
    expect(
      screen.getByRole("dialog", { name: "Reviewers" }),
    ).toBeInTheDocument();
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

describe("CustomFieldValueInput inline pickers", () => {
  const options = Array.from({ length: 10 }, (_, index) => ({
    key: `k${index}`,
    label: `Choice ${index}`,
  }));

  it("uses a popover picker for an inline select and keeps the Select in forms", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <>
        <Label htmlFor="tier">Tier</Label>
        <CustomFieldValueInput
          inline
          id="tier"
          field={{
            name: "Tier",
            format: "select",
            options: options.slice(0, 3),
          }}
          value="k1"
          onChange={onChange}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Tier" });
    expect(trigger).toHaveTextContent("Choice 1");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Choice 2" }));
    expect(onChange).toHaveBeenCalledWith("k2");
    rerender(
      <>
        <Label htmlFor="tier">Tier</Label>
        <CustomFieldValueInput
          id="tier"
          field={{
            name: "Tier",
            format: "select",
            options: options.slice(0, 3),
          }}
          value="k1"
          onChange={onChange}
        />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Tier" })).toBeInTheDocument();
  });

  it("filters a long multi-select and toggles a choice", async () => {
    const onChange = vi.fn();
    render(
      <>
        <Label htmlFor="tags">Tags</Label>
        <CustomFieldValueInput
          inline
          id="tags"
          field={{ name: "Tags", format: "multi_select", options }}
          value={["k1"]}
          onChange={onChange}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Search options" }),
      {
        target: { value: "Choice 7" },
      },
    );
    expect(screen.queryByText("Choice 2")).toBeNull();
    fireEvent.click(screen.getByText("Choice 7"));
    expect(onChange).toHaveBeenCalledWith(["k1", "k7"]);
  });
});

describe("CustomFieldValueInput date popup", () => {
  it("names the calendar popup from the field label", () => {
    render(
      <>
        <Label htmlFor="review-date">Review date</Label>
        <CustomFieldValueInput
          id="review-date"
          field={{ name: "Review date", format: "date", options: [] }}
          value="2026-10-30"
          onChange={vi.fn()}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review date" }));
    expect(
      screen.getByRole("dialog", { name: "Review date" }),
    ).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivitySelect } from "./time-shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("ActivitySelect", () => {
  it("picks the activity from a Kaneo picker popover showing names, not ids", async () => {
    const onChange = vi.fn();
    render(
      <ActivitySelect
        id="time-activity"
        label="Activity"
        value="act-1"
        onChange={onChange}
        activities={
          [
            { id: "act-1", name: "Development" },
            { id: "act-2", name: "Support" },
          ] as never
        }
      />,
    );
    const trigger = screen.getByRole("button", { name: "Activity" });
    expect(trigger).toHaveTextContent("Development");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Support" }));
    expect(onChange).toHaveBeenCalledWith("act-2");
  });
});

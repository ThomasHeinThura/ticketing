import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import SortControl from "./sort-control";

const menuModuleGate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
});

vi.mock("./sort-control-menu", async () => {
  await menuModuleGate.promise;
  return vi.importActual("./sort-control-menu");
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("SortControl deferred menu content", () => {
  it("retains the first open request and applies a choice after the content arrives", async () => {
    const onSortChange = vi.fn();
    render(
      <SortControl
        sort={{ field: "position", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Sort" });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menuitem")).toBeNull();

    await act(async () => menuModuleGate.release());

    fireEvent.click(await screen.findByRole("menuitem", { name: "Title" }));
    expect(onSortChange).toHaveBeenCalledWith({
      field: "title",
      direction: "asc",
    });
  });
});

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import GroupControl from "./group-control";

const menuModuleGate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release?.() };
});

vi.mock("./group-control-menu", async () => {
  await menuModuleGate.promise;
  return vi.importActual("./group-control-menu");
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

describe("GroupControl deferred menu content", () => {
  it("retains the first open request until the original menu content is ready", async () => {
    const onGroupChange = vi.fn();
    render(
      <GroupControl
        group="state"
        onGroupChange={onGroupChange}
        groups={["state", "assignee"]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Group" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("menuitem")).toBeNull();

    await act(async () => menuModuleGate.release());

    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(2);
    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.click(screen.getByRole("menuitem", { name: "Assignee" }));
    expect(onGroupChange).toHaveBeenCalledWith("assignee");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

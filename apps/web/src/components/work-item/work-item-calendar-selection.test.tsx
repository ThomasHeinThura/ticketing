import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScheduleSelection } from "./work-item-calendar-selection";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

function setup(paneOpen = false) {
  return renderHook(
    (props: { projectId: string; allKeys: string[] }) =>
      useScheduleSelection({ ...props, paneOpen }),
    {
      initialProps: {
        projectId: "project-1",
        allKeys: ["RM-1", "RM-2", "RM-3"],
      },
    },
  );
}

describe("useScheduleSelection (VW-3)", () => {
  it("stays inactive without a bulk capability even when the mode is on", () => {
    const { result } = setup();
    act(() => result.current.toggleMode());
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.active).toBe(false);
  });

  it("toggles keys while active and announces the count", () => {
    const { result } = setup();
    act(() => result.current.setCanBulkAct(true));
    act(() => result.current.toggleMode());
    expect(result.current.active).toBe(true);
    expect(result.current.announcement).toBe("workItems:bulk.modeOn");

    act(() => result.current.toggleKey("RM-1"));
    act(() => result.current.toggleKey("RM-2"));
    expect(result.current.selectedKeys).toEqual(["RM-1", "RM-2"]);
    expect(result.current.announcement).toBe("workItems:bulk.selected:2");

    act(() => result.current.toggleKey("RM-1"));
    expect(result.current.selectedKeys).toEqual(["RM-2"]);
  });

  it("keeps the keys a bulk action could not finish", () => {
    const { result } = setup();
    act(() => result.current.setCanBulkAct(true));
    act(() => result.current.toggleMode());
    act(() => {
      result.current.toggleKey("RM-1");
      result.current.toggleKey("RM-2");
    });
    act(() => result.current.removeKeys(["RM-1"]));
    expect(result.current.selectedKeys).toEqual(["RM-2"]);
  });

  it("clears the selection and leaves the mode", () => {
    const { result } = setup();
    act(() => result.current.setCanBulkAct(true));
    act(() => result.current.toggleMode());
    act(() => result.current.toggleKey("RM-1"));
    act(() => result.current.clear());
    expect(result.current.selectedKeys).toEqual([]);
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.announcement).toBe("workItems:bulk.modeOff");
  });

  it("drops the selection when the project changes under the same screen", () => {
    const { result, rerender } = setup();
    act(() => result.current.setCanBulkAct(true));
    act(() => result.current.toggleMode());
    act(() => result.current.toggleKey("RM-1"));
    rerender({ projectId: "project-2", allKeys: ["XY-1"] });
    expect(result.current.selectedKeys).toEqual([]);
    expect(result.current.selectionMode).toBe(false);
  });

  it("deselects an item that leaves the visible set", () => {
    const { result, rerender } = setup();
    act(() => result.current.setCanBulkAct(true));
    act(() => result.current.toggleMode());
    act(() => {
      result.current.toggleKey("RM-1");
      result.current.toggleKey("RM-2");
    });
    rerender({ projectId: "project-1", allKeys: ["RM-2", "RM-3"] });
    expect(result.current.selectedKeys).toEqual(["RM-2"]);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  CapabilityMatrix,
  type CapabilityMatrixItem,
} from "./capability-matrix";

afterEach(() => {
  cleanup();
});

const items: CapabilityMatrixItem[] = [
  {
    id: "work_item:read",
    label: "Read",
    description: "See work items in reach",
    group: "Work items",
  },
  {
    id: "work_item:create",
    label: "Create",
    description: "Create work items",
    group: "Work items",
  },
  {
    id: "service:read",
    label: "Read services",
    description: "See services",
    group: "Service management",
  },
];

describe("CapabilityMatrix", () => {
  it("groups caller-provided capability metadata and exposes its descriptions", () => {
    render(
      <CapabilityMatrix
        items={items}
        onSelectedChange={() => {}}
        selected={["work_item:read"]}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Work items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Service management" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Read" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Create" }),
    ).toHaveAccessibleDescription("Create work items");
  });

  it("reports a controlled selection change while preserving other selections", () => {
    const onSelectedChange = vi.fn();
    render(
      <CapabilityMatrix
        items={items}
        onSelectedChange={onSelectedChange}
        selected={["work_item:read", "service:read"]}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Read services" }));
    expect(onSelectedChange).toHaveBeenCalledWith(["work_item:read"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Create" }));
    expect(onSelectedChange).toHaveBeenLastCalledWith([
      "work_item:read",
      "service:read",
      "work_item:create",
    ]);
  });

  it("keeps disabled items disabled and exposes the caller's reason", () => {
    const onSelectedChange = vi.fn();
    render(
      <CapabilityMatrix
        disabled={["service:read"]}
        disabledReasons={{ "service:read": "You do not hold this capability." }}
        items={items}
        onSelectedChange={onSelectedChange}
        selected={[]}
      />,
    );

    const disabledCheckbox = screen.getByRole("checkbox", {
      name: "Read services",
    });
    expect(disabledCheckbox).toHaveAttribute("aria-disabled", "true");
    expect(disabledCheckbox).toHaveAccessibleDescription(
      "See services You do not hold this capability.",
    );
    fireEvent.click(disabledCheckbox);
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <CapabilityMatrix
        disabled={["service:read"]}
        disabledReasons={{ "service:read": "You do not hold this capability." }}
        items={items}
        onSelectedChange={() => {}}
        selected={["work_item:read"]}
      />,
    );

    await expectNoA11yViolations(baseElement);
  });
});

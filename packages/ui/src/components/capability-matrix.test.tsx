import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
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

  it("forwards its root ref and native div props", () => {
    const rootRef = React.createRef<HTMLDivElement>();
    const onClick = vi.fn();
    render(
      <CapabilityMatrix
        data-testid="capability-matrix-root"
        id="role-capabilities"
        items={items}
        onClick={onClick}
        onSelectedChange={() => {}}
        ref={rootRef}
        selected={[]}
      />,
    );

    const root = screen.getByTestId("capability-matrix-root");
    expect(root).toHaveAttribute("id", "role-capabilities");
    expect(rootRef.current).toBe(root);
    fireEvent.click(root);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders long labels and explanations without dropping their content", () => {
    const longContent: CapabilityMatrixItem[] = [
      {
        id: "service_calendar:manage",
        label: "Manage service calendars across all workspaces",
        description:
          "Create and maintain business-hour calendars used by service level agreements, including timezone rules, holiday dates, and weekday coverage windows for every workspace this role can reach.",
        group: "Service management",
      },
    ];

    render(
      <CapabilityMatrix
        items={longContent}
        onSelectedChange={() => {}}
        selected={[]}
      />,
    );

    expect(
      screen.getByText("Manage service calendars across all workspaces"),
    ).toBeVisible();
    expect(screen.getByText(longContent[0].description)).toBeVisible();
  });

  it("renders within the dark theme without changing the capability contract", () => {
    render(
      <div className="dark" data-testid="dark-theme">
        <CapabilityMatrix
          items={items}
          onSelectedChange={() => {}}
          selected={["work_item:read"]}
        />
      </div>,
    );

    expect(screen.getByTestId("dark-theme")).toHaveClass("dark");
    expect(screen.getByRole("checkbox", { name: "Read" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "Create" })).toBeVisible();
  });

  it.each([
    ["default", false, items],
    ["disabled", true, items],
    [
      "long content",
      false,
      [
        {
          id: "service_calendar:manage",
          label: "Manage service calendars across all workspaces",
          description:
            "Create and maintain business-hour calendars used by service level agreements, including timezone rules, holiday dates, and weekday coverage windows for every workspace this role can reach.",
          group: "Service management",
        },
      ],
    ],
    [
      "dark mode",
      false,
      [
        {
          id: "service_calendar:manage",
          label: "Manage service calendars across all workspaces",
          description:
            "Create and maintain business-hour calendars used by service level agreements, including timezone rules, holiday dates, and weekday coverage windows for every workspace this role can reach.",
          group: "Service management",
        },
      ],
    ],
  ] as const)(
    "has no accessibility violations in the %s story",
    async (name, isDisabled, storyItems) => {
      const matrix = (
        <CapabilityMatrix
          disabled={isDisabled ? ["service:read"] : []}
          disabledReasons={
            isDisabled
              ? { "service:read": "You do not hold this capability." }
              : undefined
          }
          items={storyItems}
          onSelectedChange={() => {}}
          selected={storyItems === items ? ["work_item:read"] : []}
        />
      );
      const { baseElement } = render(
        name === "dark mode" ? <div className="dark">{matrix}</div> : matrix,
      );

      await expectNoA11yViolations(baseElement);
    },
  );
});

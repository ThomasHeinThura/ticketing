import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  CapabilityMatrix,
  type CapabilityMatrixItem,
} from "./capability-matrix";

const meta = {
  title: "Primitives/CapabilityMatrix",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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
    id: "work_item:assign",
    label: "Assign",
    description: "Assign to anyone on the roster",
    group: "Work items",
  },
  {
    id: "service:read",
    label: "Read services",
    description: "See services",
    group: "Service management",
  },
  {
    id: "service:manage",
    label: "Manage services",
    description: "Manage services, dependencies and service state",
    group: "Service management",
  },
];

const longContentItems: CapabilityMatrixItem[] = [
  {
    id: "service_calendar:manage",
    label: "Manage service calendars across all workspaces",
    description:
      "Create and maintain business-hour calendars used by service level agreements, including timezone rules, holiday dates, and weekday coverage windows for every workspace this role can reach.",
    group: "Service management",
  },
];

function InteractiveMatrix({
  disabled = false,
  values = items,
}: {
  disabled?: boolean;
  values?: CapabilityMatrixItem[];
}) {
  const [selected, setSelected] = useState([
    "work_item:read",
    "work_item:create",
    "service:read",
  ]);

  return (
    <CapabilityMatrix
      disabled={disabled ? ["service:manage"] : []}
      disabledReasons={
        disabled
          ? { "service:manage": "You do not hold this capability yourself." }
          : undefined
      }
      items={values}
      onSelectedChange={setSelected}
      selected={selected}
    />
  );
}

export const Editable: Story = {
  render: () => <InteractiveMatrix />,
};

export const WithDisabledCapability: Story = {
  render: () => <InteractiveMatrix disabled />,
};

export const LongContent: Story = {
  render: () => <InteractiveMatrix values={longContentItems} />,
};

export const DarkMode: Story = {
  render: () => (
    <div className="dark min-h-screen bg-background p-4 text-foreground">
      <InteractiveMatrix values={longContentItems} />
    </div>
  ),
};

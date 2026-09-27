import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox";

const meta = {
  title: "Primitives/Checkbox",
  component: Checkbox,
  args: { "aria-label": "Accept terms" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

export const Indeterminate: Story = {
  args: { indeterminate: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { defaultChecked: true, disabled: true },
};

export const Invalid: Story = {
  args: { "aria-invalid": true },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Create work item" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Loading: Story = {
  args: { loading: true },
};

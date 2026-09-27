import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircularProgress } from "./circular-progress";

const meta = {
  title: "Primitives/CircularProgress",
  component: CircularProgress,
} satisfies Meta<typeof CircularProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotStarted: Story = {
  args: { completed: 0, total: 4 },
};

export const InProgress: Story = {
  args: { completed: 2, total: 4 },
};

export const Complete: Story = {
  args: { completed: 4, total: 4 },
};

export const Empty: Story = {
  args: { completed: 0, total: 0 },
};

export const Large: Story = {
  args: { completed: 3, total: 5, size: 32, strokeWidth: 3 },
};

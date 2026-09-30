import type { Meta, StoryObj } from "@storybook/react-vite";
import { Calendar } from "./calendar";

const meta = {
  title: "Primitives/Calendar",
  component: Calendar,
  args: {
    mode: "single",
    defaultMonth: new Date(2026, 8, 1),
    today: new Date(2026, 8, 29),
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WeekStartsOnMonday: Story = {
  args: { weekStartsOn: 1 },
};

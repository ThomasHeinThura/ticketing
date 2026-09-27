import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./skeleton";

const meta = {
  title: "Primitives/Skeleton",
  component: Skeleton,
  args: { "aria-hidden": true },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Skeleton {...args} className="size-10 rounded-full" />
      <div className="grid gap-2">
        <Skeleton {...args} className="h-4 w-48" />
        <Skeleton {...args} className="h-3 w-32" />
      </div>
    </div>
  ),
};

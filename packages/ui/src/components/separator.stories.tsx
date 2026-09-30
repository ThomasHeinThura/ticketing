import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator";

const meta = {
  title: "Primitives/Separator",
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};
export const Vertical: Story = {
  render: () => (
    <div className="flex h-12 items-center gap-4 text-sm text-foreground">
      <span>Before</span>
      <Separator orientation="vertical" />
      <span>After</span>
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "./scroll-area";

const meta = {
  title: "Primitives/ScrollArea",
  component: ScrollArea,
  args: { className: "h-32 w-64" },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <ScrollArea {...args}>
      <p>First item</p>
      <p>Second item</p>
      <p>Third item</p>
      <p>Fourth item</p>
      <p>Fifth item</p>
      <p>Sixth item</p>
    </ScrollArea>
  ),
};

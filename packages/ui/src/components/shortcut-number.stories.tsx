import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { ShortcutNumber } from "./shortcut-number";

const meta = {
  title: "Primitives/ShortcutNumber",
  component: ShortcutNumber,
  args: { number: 1 },
} satisfies Meta<typeof ShortcutNumber>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Button aria-label="Open search" variant="outline">
      Open search
      <ShortcutNumber {...args} />
    </Button>
  ),
};

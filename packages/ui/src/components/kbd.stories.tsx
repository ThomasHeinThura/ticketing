import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd, KbdGroup, KbdSequence } from "./kbd";

const meta = {
  title: "Primitives/Kbd",
  component: Kbd,
  args: { children: "K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Grouped: Story = {
  render: () => (
    <KbdGroup aria-label="Command K">
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
  ),
};

export const Sequence: Story = {
  render: () => (
    <KbdSequence description="Save shortcut" keys={["Ctrl", "Shift", "S"]} />
  ),
};

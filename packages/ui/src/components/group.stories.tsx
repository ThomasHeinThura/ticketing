import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Group, GroupSeparator, GroupText } from "./group";

const meta = {
  title: "Primitives/Group",
  component: Group,
  args: {
    children: (
      <>
        <Button variant="secondary">Left</Button>
        <Button variant="secondary">Middle</Button>
        <Button variant="secondary">Right</Button>
      </>
    ),
  },
} satisfies Meta<typeof Group>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};

export const Vertical: Story = {
  args: { orientation: "vertical" },
};

export const WithText: Story = {
  args: {
    children: (
      <>
        <GroupText>https://</GroupText>
        <GroupSeparator />
        <Button variant="secondary">example.com</Button>
      </>
    ),
  },
};

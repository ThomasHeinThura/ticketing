import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar, AvatarFallback } from "./avatar";

const meta = {
  title: "Primitives/Avatar",
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFallback: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>AM</AvatarFallback>
    </Avatar>
  ),
};

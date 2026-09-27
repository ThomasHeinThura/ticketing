import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "./label";

const meta = {
  title: "Primitives/Label",
  component: Label,
  args: { children: "Email address" },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithControl: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Label htmlFor="story-label-email">Email address</Label>
      <input id="story-label-email" type="email" />
    </div>
  ),
};

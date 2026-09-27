import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./toggle";

const meta = {
  title: "Primitives/Toggle",
  component: Toggle,
  args: { children: "Bold", "aria-label": "Bold" },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Pressed: Story = { args: { defaultPressed: true } };

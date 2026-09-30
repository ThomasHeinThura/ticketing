import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./switch";

const meta = {
  title: "Primitives/Switch",
  component: Switch,
  args: { "aria-label": "Enable notifications" },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };

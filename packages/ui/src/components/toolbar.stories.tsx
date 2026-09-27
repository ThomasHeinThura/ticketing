import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "./toolbar";

const meta = {
  title: "Primitives/Toolbar",
  component: Toolbar,
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Toolbar aria-label="Text formatting">
      <ToolbarGroup>
        <ToolbarButton aria-label="Bold">B</ToolbarButton>
        <ToolbarButton aria-label="Italic">I</ToolbarButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton>More options</ToolbarButton>
    </Toolbar>
  ),
};

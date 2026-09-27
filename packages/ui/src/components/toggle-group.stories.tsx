import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const meta = {
  title: "Primitives/ToggleGroup",
  component: ToggleGroup,
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ToggleGroup aria-label="Text alignment" defaultValue={["left"]}>
      <ToggleGroupItem aria-label="Align left" value="left">
        Left
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="Align center" value="center">
        Center
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="Align right" value="right">
        Right
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

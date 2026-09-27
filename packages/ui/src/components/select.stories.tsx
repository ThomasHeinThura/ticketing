import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./select";

const meta = {
  title: "Primitives/Select",
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Select
      items={[
        { value: "low", label: "Low" },
        { value: "high", label: "High" },
      ]}
    >
      <SelectTrigger aria-label="Priority">
        <SelectValue placeholder="Choose priority" />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="high">High</SelectItem>
      </SelectPopup>
    </Select>
  ),
};

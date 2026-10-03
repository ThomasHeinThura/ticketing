import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectButton,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
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
      <SelectButton aria-label="Priority">Choose priority</SelectButton>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Priority</SelectGroupLabel>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem value="high">High</SelectItem>
        </SelectGroup>
      </SelectPopup>
    </Select>
  ),
};

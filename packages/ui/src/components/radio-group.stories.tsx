import type { Meta, StoryObj } from "@storybook/react-vite";
import { Radio, RadioGroup } from "./radio-group";

const meta = {
  title: "Primitives/RadioGroup",
  component: RadioGroup,
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup aria-label="Billing cycle" defaultValue="monthly">
      <div className="flex items-center gap-2">
        <Radio aria-label="Monthly" value="monthly" />
        <span>Monthly</span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-label="Yearly" value="yearly" />
        <span>Yearly</span>
      </div>
    </RadioGroup>
  ),
};

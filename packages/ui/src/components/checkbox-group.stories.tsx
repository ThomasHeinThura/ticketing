import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox";
import { CheckboxGroup } from "./checkbox-group";

const meta = {
  title: "Primitives/CheckboxGroup",
  component: CheckboxGroup,
} satisfies Meta<typeof CheckboxGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <CheckboxGroup {...args} defaultValue={["bug"]}>
      <Checkbox aria-label="Bug" value="bug" />
      <Checkbox aria-label="Feature" value="feature" />
      <Checkbox aria-label="Chore" value="chore" />
    </CheckboxGroup>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <CheckboxGroup {...args} defaultValue={["bug"]} disabled>
      <Checkbox aria-label="Bug" value="bug" />
      <Checkbox aria-label="Feature" value="feature" />
    </CheckboxGroup>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldControl, FieldLabel } from "./field";
import { Fieldset, FieldsetLegend } from "./fieldset";

const meta = {
  title: "Primitives/Fieldset",
  component: Fieldset,
} satisfies Meta<typeof Fieldset>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Fieldset>
      <FieldsetLegend>Notifications</FieldsetLegend>
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl placeholder="you@example.com" type="email" />
      </Field>
      <Field>
        <FieldLabel>Phone</FieldLabel>
        <FieldControl placeholder="+1 555 0100" type="tel" />
      </Field>
    </Fieldset>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Fieldset disabled>
      <FieldsetLegend>Notifications</FieldsetLegend>
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl placeholder="you@example.com" type="email" />
      </Field>
    </Fieldset>
  ),
};

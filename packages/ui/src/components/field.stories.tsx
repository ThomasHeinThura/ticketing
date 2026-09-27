import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "./field";

const meta = {
  title: "Primitives/Field",
  component: Field,
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Field>
      <FieldLabel>Email</FieldLabel>
      <FieldControl placeholder="you@example.com" type="email" />
      <FieldDescription>We only use this to send receipts.</FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field>
      <FieldLabel>Email</FieldLabel>
      <FieldControl aria-invalid placeholder="you@example.com" type="email" />
      <FieldError match={true}>Enter a valid email address.</FieldError>
    </Field>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Field disabled>
      <FieldLabel>Email</FieldLabel>
      <FieldControl placeholder="you@example.com" type="email" />
      <FieldDescription>We only use this to send receipts.</FieldDescription>
    </Field>
  ),
};

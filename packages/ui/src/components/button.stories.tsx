import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { SaveButton } from "./save-button";

const meta = {
  title: "Primitives/Button",
  component: Button,
  args: { children: "Create work item" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Loading: Story = {
  args: { loading: true },
};

export const SaveIdle: Story = {
  render: () => (
    <SaveButton pending={false} success={false} savedLabel="Saved">
      Save changes
    </SaveButton>
  ),
};

export const SaveWorking: Story = {
  render: () => (
    <SaveButton pending success={false} savedLabel="Saved">
      Save changes
    </SaveButton>
  ),
};

function SaveSuccessExample() {
  const [success, setSuccess] = useState(false);
  useEffect(() => setSuccess(true), []);
  return (
    <SaveButton pending={false} success={success} savedLabel="Saved">
      Save changes
    </SaveButton>
  );
}

export const SaveDone: Story = { render: () => <SaveSuccessExample /> };

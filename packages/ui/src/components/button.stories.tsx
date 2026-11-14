import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
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
    <SaveButton
      pending={false}
      success={false}
      savedLabel="Saved"
      workingLabel="Saving…"
    >
      Save changes
    </SaveButton>
  ),
};

export const SaveWorking: Story = {
  render: () => (
    <SaveButton
      pending
      success={false}
      feedbackState="working"
      savedLabel="Saved"
      workingLabel="Saving…"
    >
      Save changes
    </SaveButton>
  ),
};

export const SaveDone: Story = {
  render: () => (
    <SaveButton
      pending={false}
      success
      feedbackState="done"
      savedLabel="Saved"
      workingLabel="Saving…"
    >
      Save changes
    </SaveButton>
  ),
};

export const SaveWithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <SaveButton
        size="sm"
        pending={false}
        success={false}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        <Plus aria-hidden="true" />
        Add activity
      </SaveButton>
      <SaveButton
        size="default"
        pending={false}
        success={false}
        savedLabel="Saved"
        workingLabel="Saving…"
      >
        <Plus aria-hidden="true" />
        Add activity
      </SaveButton>
    </div>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckCircleIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "./button";
import { EmptyState, FeatureOff } from "./empty-state";

/** A plain link element for the action's `render`; the button supplies its text. */
function SettingsLink(props: React.ComponentProps<"a">) {
  return <a {...props} />;
}

const meta = {
  title: "Primitives/EmptyState",
  component: EmptyState,
  args: { title: "No approvals are waiting for you." },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <EmptyState
      {...args}
      icon={<CheckCircleIcon />}
      description="Approval requests from the support team appear here."
      action={
        <Button variant="outline" render={<a href="#requests" />}>
          My requests
        </Button>
      }
    />
  ),
};

export const FeatureOffWithAction: Story = {
  render: () => (
    <FeatureOff
      title="Reports are off"
      description="Turn on Reports in the workspace feature settings."
      action={{
        label: "Turn on in Features",
        render: <SettingsLink href="#features" />,
      }}
    />
  ),
};

export const FeatureOffReadOnly: Story = {
  render: () => (
    <FeatureOff
      title="Reports are off"
      description="A workspace admin can turn on Reports in the workspace feature settings."
    />
  ),
};

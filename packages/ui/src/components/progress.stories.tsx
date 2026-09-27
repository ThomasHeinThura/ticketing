import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "./progress";

const meta = {
  title: "Primitives/Progress",
  component: Progress,
  args: { value: 40 },
  render: (args) => (
    <Progress {...args}>
      <ProgressLabel>Uploading</ProgressLabel>
      <ProgressValue />
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  ),
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Complete: Story = {
  args: { value: 100 },
};

export const Indeterminate: Story = {
  args: { value: null },
};

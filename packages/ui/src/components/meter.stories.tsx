import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "./meter";

const meta = {
  title: "Primitives/Meter",
  component: Meter,
  args: { value: 40, "aria-label": "Disk usage" },
  render: (args) => (
    <Meter {...args}>
      <MeterLabel>Disk usage</MeterLabel>
      <MeterValue />
      <MeterTrack>
        <MeterIndicator />
      </MeterTrack>
    </Meter>
  ),
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Low: Story = {
  args: { value: 10 },
};

export const High: Story = {
  args: { value: 92 },
};

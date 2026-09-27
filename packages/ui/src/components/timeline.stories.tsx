import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "./timeline";

const meta = {
  title: "Primitives/Timeline",
  component: Timeline,
  args: { orientation: "vertical", value: 2 },
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Timeline {...args}>
      <TimelineItem step={1}>
        <TimelineIndicator />
        <TimelineSeparator />
        <TimelineHeader>
          <TimelineDate>September 20</TimelineDate>
          <TimelineTitle>Request created</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>Initial details were added.</TimelineContent>
      </TimelineItem>
      <TimelineItem step={2}>
        <TimelineIndicator />
        <TimelineSeparator />
        <TimelineHeader>
          <TimelineDate>September 22</TimelineDate>
          <TimelineTitle>Assigned to a team</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>The support team is reviewing it.</TimelineContent>
      </TimelineItem>
      <TimelineItem step={3}>
        <TimelineIndicator />
        <TimelineHeader>
          <TimelineTitle>Resolved</TimelineTitle>
        </TimelineHeader>
        <TimelineContent>Resolution details will appear here.</TimelineContent>
      </TimelineItem>
    </Timeline>
  ),
};

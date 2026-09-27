import type { Meta, StoryObj } from "@storybook/react-vite";
import { InboxIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";

const meta = {
  title: "Primitives/Empty",
  component: Empty,
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyHeader>
        <EmptyTitle>No work items</EmptyTitle>
        <EmptyDescription>
          Create a work item to start tracking work.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <button type="button">New work item</button>
      </EmptyContent>
    </Empty>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>Inbox zero</EmptyTitle>
        <EmptyDescription>
          There is nothing waiting on you right now.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

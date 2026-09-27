import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";

const meta = {
  title: "Primitives/Collapsible",
  component: Collapsible,
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Collapsible {...args}>
      <CollapsibleTrigger>Show details</CollapsibleTrigger>
      <CollapsibleContent>Created by Priya Sharma on Jan 4.</CollapsibleContent>
    </Collapsible>
  ),
};

export const DefaultOpen: Story = {
  render: (args) => (
    <Collapsible {...args} defaultOpen>
      <CollapsibleTrigger>Show details</CollapsibleTrigger>
      <CollapsibleContent>Created by Priya Sharma on Jan 4.</CollapsibleContent>
    </Collapsible>
  ),
};

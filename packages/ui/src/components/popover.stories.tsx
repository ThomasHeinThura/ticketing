import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  Popover,
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

const meta = {
  title: "Primitives/Popover",
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="secondary">Open</Button>} />
      <PopoverPopup>
        <PopoverTitle>Notifications</PopoverTitle>
        <PopoverDescription>You're all caught up.</PopoverDescription>
        <PopoverClose render={<Button variant="secondary">Close</Button>} />
      </PopoverPopup>
    </Popover>
  ),
};

export const OpenByDefault: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="secondary">Open</Button>} />
      <PopoverPopup>
        <PopoverTitle>Notifications</PopoverTitle>
        <PopoverDescription>You're all caught up.</PopoverDescription>
      </PopoverPopup>
    </Popover>
  ),
};

export const TooltipStyle: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger
        render={<Button variant="secondary">Hover target</Button>}
      />
      <PopoverPopup aria-label="Quick tip" tooltipStyle>
        Quick tip
      </PopoverPopup>
    </Popover>
  ),
};

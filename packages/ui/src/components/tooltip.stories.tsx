import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

const meta = {
  title: "Primitives/Tooltip",
  component: TooltipTrigger,
} satisfies Meta<typeof TooltipTrigger>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger>Save</TooltipTrigger>
        <TooltipContent>Save your changes</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};

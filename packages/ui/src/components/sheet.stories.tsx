import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sheet, SheetPopup, SheetTitle } from "./sheet";

const meta = {
  title: "Primitives/Sheet",
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetPopup closeLabel="Close filters">
        <SheetTitle>Filters</SheetTitle>
        <p>Choose which work items to show.</p>
      </SheetPopup>
    </Sheet>
  ),
};

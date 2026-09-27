import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

const meta = {
  title: "Primitives/Dialog",
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogPopup closeLabel="Close">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  ),
};

export const Open: Story = {
  render: (args) => (
    <Dialog {...args} defaultOpen>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogPopup closeLabel="Close">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  ),
};

export const WithoutCloseButton: Story = {
  render: (args) => (
    <Dialog {...args} defaultOpen>
      <DialogPopup showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Restart required</DialogTitle>
          <DialogDescription>
            Confirm below to apply the update.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Restart now</button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  ),
};

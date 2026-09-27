import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

const meta = {
  title: "Primitives/AlertDialog",
  component: AlertDialog,
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogTrigger>Delete work item</AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogTitle>Delete this work item?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Delete</button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  ),
};

export const Open: Story = {
  render: (args) => (
    <AlertDialog {...args} defaultOpen>
      <AlertDialogTrigger>Delete work item</AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogTitle>Delete this work item?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Delete</button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  ),
};

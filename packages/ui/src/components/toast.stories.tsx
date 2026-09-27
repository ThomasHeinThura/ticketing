import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { ToastProvider, toastManager } from "./toast";

const meta = {
  title: "Primitives/Toast",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ToastProvider>
      <Button
        onClick={() =>
          toastManager.add({
            title: "Changes saved",
            description: "Your workspace settings were updated.",
            type: "success",
          })
        }
        variant="outline"
      >
        Show success toast
      </Button>
    </ToastProvider>
  ),
};

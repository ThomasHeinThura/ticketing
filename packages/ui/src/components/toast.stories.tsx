import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
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

export const SuccessProgress: Story = {
  render: () => (
    <ToastProvider>
      <Button
        onClick={() =>
          toastManager.add({
            title: "Changes saved",
            type: "success",
            timeout: 10000,
          })
        }
      >
        Show success progress
      </Button>
    </ToastProvider>
  ),
};

function ProgressControls() {
  const id = useRef("");
  return (
    <ToastProvider>
      <Button
        onClick={() => {
          id.current = toastManager.add({
            title: "Counting",
            type: "loading",
            timeout: 0,
          });
        }}
      >
        Start
      </Button>
      <Button
        onClick={() =>
          toastManager.update(id.current, {
            title: "Counting",
            type: "success",
            timeout: 4000,
          })
        }
      >
        Complete
      </Button>
      <Button
        onClick={() => toastManager.update(id.current, { timeout: 6000 })}
      >
        Restart
      </Button>
      <Button onClick={() => toastManager.update(id.current, { timeout: 0 })}>
        Persist
      </Button>
    </ToastProvider>
  );
}
export const ProgressControlsStory: Story = {
  render: () => <ProgressControls />,
};

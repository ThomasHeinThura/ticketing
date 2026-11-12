import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
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

function SuccessProgressExample() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (
        document.querySelector('[data-slot="toast-title"]')?.textContent ===
        "Changes saved"
      ) {
        setReady(true);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const id = toastManager.add({
      title: "Changes saved",
      type: "success",
      timeout: 600000,
    });
    return () => {
      observer.disconnect();
      toastManager.close(id);
    };
  }, []);
  // The screenshot runner uses reduced motion, which hides the countdown line.
  // Keep the story root empty until the lazy viewport has rendered the toast.
  return <ToastProvider>{ready ? <div /> : null}</ToastProvider>;
}

export const SuccessProgress: Story = {
  render: () => <SuccessProgressExample />,
};

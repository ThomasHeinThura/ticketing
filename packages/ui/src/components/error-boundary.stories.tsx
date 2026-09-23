import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
} from "./error-boundary";

function DemoFallback({ error, resetError }: ErrorBoundaryFallbackProps) {
  return (
    <div role="alert">
      <p>{error.message}</p>
      <button onClick={resetError} type="button">
        Retry
      </button>
    </div>
  );
}

function ExampleCrash(): never {
  throw new Error("Example render error");
}

const meta = {
  title: "Primitives/ErrorBoundary",
  component: ErrorBoundary,
  args: { fallback: DemoFallback, children: <ExampleCrash /> },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaughtError: Story = {};

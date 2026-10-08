import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";

const meta: Meta<typeof Alert> = {
  title: "Primitives/Alert",
  component: Alert,
  decorators: [
    (Story) => (
      <div className="bg-background">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (_args) => (
    <Alert variant="default">
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        This is a default informational alert.
      </AlertDescription>
    </Alert>
  ),
};

export const ErrorVariant: Story = {
  render: (_args) => (
    <Alert variant="error">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>Your changes could not be saved.</AlertDescription>
    </Alert>
  ),
};

export const Info: Story = {
  render: (_args) => (
    <Alert variant="info">
      <AlertTitle>New version available</AlertTitle>
      <AlertDescription>Refresh to pick up the latest build.</AlertDescription>
    </Alert>
  ),
};

export const Success: Story = {
  render: (_args) => (
    <Alert variant="success">
      <AlertTitle>Saved</AlertTitle>
      <AlertDescription>Your changes have been saved.</AlertDescription>
    </Alert>
  ),
};

export const Warning: Story = {
  render: (_args) => (
    <Alert variant="warning">
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>Your session expires in 5 minutes.</AlertDescription>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: (_args) => (
    <Alert variant="error">
      <AlertTitle>Upload failed</AlertTitle>
      <AlertDescription>The file exceeds the size limit.</AlertDescription>
      <AlertAction>
        <button type="button">Retry</button>
      </AlertAction>
    </Alert>
  ),
};

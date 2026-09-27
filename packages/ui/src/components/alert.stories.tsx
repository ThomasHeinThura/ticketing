import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";

const meta = {
  title: "Primitives/Alert",
  component: Alert,
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        This is a default informational alert.
      </AlertDescription>
    </Alert>
  ),
};

export const ErrorVariant: Story = {
  render: (args) => (
    <Alert {...args} variant="error">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>Your changes could not be saved.</AlertDescription>
    </Alert>
  ),
};

export const Info: Story = {
  render: (args) => (
    <Alert {...args} variant="info">
      <AlertTitle>New version available</AlertTitle>
      <AlertDescription>Refresh to pick up the latest build.</AlertDescription>
    </Alert>
  ),
};

export const Success: Story = {
  render: (args) => (
    <Alert {...args} variant="success">
      <AlertTitle>Saved</AlertTitle>
      <AlertDescription>Your changes have been saved.</AlertDescription>
    </Alert>
  ),
};

export const Warning: Story = {
  render: (args) => (
    <Alert {...args} variant="warning">
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>Your session expires in 5 minutes.</AlertDescription>
    </Alert>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Alert {...args} variant="error">
      <AlertTitle>Upload failed</AlertTitle>
      <AlertDescription>The file exceeds the size limit.</AlertDescription>
      <AlertAction>
        <button type="button">Retry</button>
      </AlertAction>
    </Alert>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta = {
  title: "Primitives/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Work item #42</CardTitle>
        <CardDescription>Fix the login redirect</CardDescription>
      </CardHeader>
      <CardContent>Assigned to Priya Sharma.</CardContent>
      <CardFooter>Updated 2 hours ago</CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Payment failed</CardTitle>
        <CardDescription>Card ending in 4242 was declined.</CardDescription>
        <CardAction>
          <Badge variant="error">Urgent</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>Retry the charge or update the billing method.</CardContent>
      <CardFooter>
        <button type="button">Retry payment</button>
      </CardFooter>
    </Card>
  ),
};

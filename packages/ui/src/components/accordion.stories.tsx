import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "./accordion";

const meta = {
  title: "Primitives/Accordion",
  component: Accordion,
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Accordion {...args} className="w-80">
      <AccordionItem value="general">
        <AccordionTrigger>General</AccordionTrigger>
        <AccordionPanel>Workspace name, timezone and locale.</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="members">
        <AccordionTrigger>Members</AccordionTrigger>
        <AccordionPanel>Invite teammates and manage roles.</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="billing">
        <AccordionTrigger>Billing</AccordionTrigger>
        <AccordionPanel>Plan, seats and payment method.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const DefaultExpanded: Story = {
  render: (args) => (
    <Accordion {...args} className="w-80" defaultValue={["general"]}>
      <AccordionItem value="general">
        <AccordionTrigger>General</AccordionTrigger>
        <AccordionPanel>Workspace name, timezone and locale.</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="members">
        <AccordionTrigger>Members</AccordionTrigger>
        <AccordionPanel>Invite teammates and manage roles.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: (args) => (
    <Accordion
      {...args}
      className="w-80"
      defaultValue={["general", "members"]}
      multiple
    >
      <AccordionItem value="general">
        <AccordionTrigger>General</AccordionTrigger>
        <AccordionPanel>Workspace name, timezone and locale.</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="members">
        <AccordionTrigger>Members</AccordionTrigger>
        <AccordionPanel>Invite teammates and manage roles.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

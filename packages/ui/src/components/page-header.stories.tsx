import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon } from "lucide-react";
import { Button } from "./button";
import { PageContainer, PageHeader } from "./page-header";

const meta = {
  title: "Primitives/PageHeader",
  component: PageHeader,
  args: { title: "Services" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {
  render: (args) => (
    <PageContainer>
      <PageHeader {...args} title="Inbox" />
    </PageContainer>
  ),
};

export const WithDescriptionAndActions: Story = {
  render: (args) => (
    <PageContainer>
      <PageHeader
        {...args}
        description="Every service your teams run, with its current status."
        actions={
          <Button>
            <PlusIcon aria-hidden="true" />
            New service
          </Button>
        }
      />
    </PageContainer>
  ),
};

export const WithTabs: Story = {
  render: (args) => (
    <PageContainer>
      <PageHeader
        {...args}
        tabs={
          <nav aria-label="Service management" className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              aria-current="page"
              render={<a href="#services" />}
            >
              Services
            </Button>
            <Button size="sm" variant="ghost" render={<a href="#changes" />}>
              Change calendar
            </Button>
          </nav>
        }
      />
    </PageContainer>
  ),
};

export const NarrowContainer: Story = {
  render: (args) => (
    <PageContainer variant="narrow">
      <PageHeader
        {...args}
        title="General"
        description="Name and describe this workspace."
      />
      <p className="text-sm">Form content sits in a 48rem reading column.</p>
    </PageContainer>
  ),
};

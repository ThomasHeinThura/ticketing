import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "./preview-card";

const meta = {
  title: "Primitives/PreviewCard",
  component: PreviewCard,
} satisfies Meta<typeof PreviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <PreviewCard>
      <PreviewCardTrigger>@taskdesk</PreviewCardTrigger>
      <PreviewCardPopup>
        TaskDesk is a service desk platform for growing teams.
      </PreviewCardPopup>
    </PreviewCard>
  ),
};

export const OpenByDefault: Story = {
  render: () => (
    <PreviewCard open>
      <PreviewCardTrigger>@taskdesk</PreviewCardTrigger>
      <PreviewCardPopup>
        TaskDesk is a service desk platform for growing teams.
      </PreviewCardPopup>
    </PreviewCard>
  ),
};

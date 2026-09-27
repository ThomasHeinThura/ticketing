import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "./frame";

const meta = {
  title: "Primitives/Frame",
  component: Frame,
} satisfies Meta<typeof Frame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Workspace settings</FrameTitle>
          <FrameDescription>
            Manage who can access this workspace.
          </FrameDescription>
        </FrameHeader>
        <FrameFooter>Last updated 2 days ago.</FrameFooter>
      </FramePanel>
    </Frame>
  ),
};

export const MultiplePanels: Story = {
  render: () => (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>General</FrameTitle>
        </FrameHeader>
      </FramePanel>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Danger zone</FrameTitle>
        </FrameHeader>
      </FramePanel>
    </Frame>
  ),
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

const meta = {
  title: "Primitives/Avatar",
  component: Avatar,
  args: { children: <AvatarFallback>TH</AvatarFallback> },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fallback: Story = {};

export const WithImage: Story = {
  args: {
    children: (
      <>
        <AvatarImage
          alt="Thomas Hein Thura"
          src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Ctext x=%2232%22 y=%2232%22 text-anchor=%22middle%22 dominant-baseline=%22central%22 font-size=%2228%22 font-weight=%22bold%22%3ETH%3C/text%3E%3C/svg%3E"
        />
        <AvatarFallback>TH</AvatarFallback>
      </>
    ),
  },
};

export const CustomSize: Story = {
  args: {
    className: "size-12",
  },
};

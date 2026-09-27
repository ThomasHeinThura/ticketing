import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination";

const meta = {
  title: "Primitives/Pagination",
  component: Pagination,
  args: { label: "Work items pagination" },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Pagination {...args}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            ariaLabel="Go to previous page"
            href="?page=1"
            label="Previous"
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink aria-label="Go to page 1" href="?page=1">
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink
            aria-label="Page 2, current page"
            href="?page=2"
            isActive
          >
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink aria-label="Go to page 3" href="?page=3">
            3
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis moreLabel="More pages" />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            ariaLabel="Go to next page"
            href="?page=3"
            label="Next"
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
};

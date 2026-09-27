import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("has a named navigation landmark and no accessibility violations", async () => {
    const { baseElement } = render(
      <Pagination label="Work items pagination">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              ariaLabel="Go to previous page"
              href="?page=1"
              label="Previous"
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink
              aria-label="Current page, 2"
              href="?page=2"
              isActive
            >
              2
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              ariaLabel="Go to next page"
              href="?page=3"
              label="Next"
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );

    await expectNoA11yViolations(baseElement);
  });
});

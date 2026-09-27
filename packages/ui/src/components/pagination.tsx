"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/cn";
import { type Button, buttonVariants } from "./button";

function Pagination({
  label,
  className,
  ...props
}: React.ComponentProps<"nav"> & { label: string }) {
  return (
    <nav
      aria-label={label}
      className={cn("mx-auto flex w-full justify-center", className)}
      data-slot="pagination"
      {...props}
    />
  );
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex flex-row items-center gap-1", className)}
      data-slot="pagination-content"
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
  size?: React.ComponentProps<typeof Button>["size"];
} & useRender.ComponentProps<"a">;

function PaginationLink({
  className,
  isActive,
  size = "icon",
  render,
  ...props
}: PaginationLinkProps) {
  const defaultProps = {
    "aria-current": isActive ? ("page" as const) : undefined,
    className: render
      ? className
      : cn(
          buttonVariants({
            size,
            variant: isActive ? "outline" : "ghost",
          }),
          className,
        ),
    "data-active": isActive,
    "data-slot": "pagination-link",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}

function PaginationPrevious({
  className,
  ariaLabel,
  label,
  ...props
}: React.ComponentProps<typeof PaginationLink> & {
  /** Announced by assistive tech, e.g. "Go to previous page". */
  ariaLabel: string;
  /** Visible text, hidden below `sm`, e.g. "Previous". */
  label: string;
}) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      className={cn("max-sm:aspect-square max-sm:p-0", className)}
      size="default"
      {...props}
    >
      <ChevronLeftIcon className="sm:-ms-1" />
      <span className="max-sm:hidden">{label}</span>
    </PaginationLink>
  );
}

function PaginationNext({
  className,
  ariaLabel,
  label,
  ...props
}: React.ComponentProps<typeof PaginationLink> & {
  /** Announced by assistive tech, e.g. "Go to next page". */
  ariaLabel: string;
  /** Visible text, hidden below `sm`, e.g. "Next". */
  label: string;
}) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      className={cn("max-sm:aspect-square max-sm:p-0", className)}
      size="default"
      {...props}
    >
      <span className="max-sm:hidden">{label}</span>
      <ChevronRightIcon className="sm:-me-1" />
    </PaginationLink>
  );
}

function PaginationEllipsis({
  className,
  moreLabel,
  ...props
}: React.ComponentProps<"span"> & { moreLabel: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex min-w-7 justify-center", className)}
      data-slot="pagination-ellipsis"
      {...props}
    >
      <MoreHorizontalIcon className="size-5 sm:size-4" />
      <span className="sr-only">{moreLabel}</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};

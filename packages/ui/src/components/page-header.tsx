import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * The one page frame (UX-1, DS-01): `full` for lists and tables, `narrow` for forms and
 * reading. Both keep the 24 px gutter and 24 px rhythm the service-management and settings
 * pages already use.
 */
const pageContainerVariants = cva("flex w-full min-w-0 flex-col gap-6 p-6", {
  defaultVariants: {
    variant: "full",
  },
  variants: {
    variant: {
      full: "",
      narrow: "mx-auto max-w-3xl",
    },
  },
});

function PageContainer({
  className,
  variant = "full",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof pageContainerVariants>) {
  return (
    <div
      className={cn(pageContainerVariants({ variant }), className)}
      data-slot="page-container"
      data-variant={variant}
      {...props}
    />
  );
}

type PageHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** The page's name, rendered as its only `h1`. */
  title: React.ReactNode;
  /** One muted line under the title. */
  description?: React.ReactNode;
  /** Page-level actions, right-aligned beside the title. */
  actions?: React.ReactNode;
  /** Section tabs or meta shown under the title row. */
  tabs?: React.ReactNode;
};

/** The one page title block (UX-1, DS-01), sized like General settings. */
function PageHeader({
  title,
  description,
  actions,
  tabs,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-slot="page-header"
      {...props}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-semibold text-2xl" data-slot="page-header-title">
            {title}
          </h1>
          {description ? (
            <p
              className="max-w-2xl text-muted-foreground text-sm"
              data-slot="page-header-description"
            >
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div
            className="flex flex-wrap items-center gap-2"
            data-slot="page-header-actions"
          >
            {actions}
          </div>
        ) : null}
      </div>
      {tabs ? <div data-slot="page-header-tabs">{tabs}</div> : null}
    </div>
  );
}

export {
  PageContainer,
  PageHeader,
  type PageHeaderProps,
  pageContainerVariants,
};

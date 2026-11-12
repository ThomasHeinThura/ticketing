import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * The one page frame (UX-1, DS-01). `width` is the reading width: `full` for lists and tables,
 * `3xl`, `4xl`, `5xl` and `6xl` for the capped, centred pages the product already uses (forms,
 * detail pages, dashboards). `gutter` is the page padding: `default` is 24 px, `compact` 16 px
 * (Inbox, My work), `responsive` 16 px that grows to 24 px from `sm` (portal pages). The gap
 * between blocks is always 24 px.
 */
const pageContainerVariants = cva("flex w-full min-w-0 flex-col gap-6", {
  defaultVariants: {
    gutter: "default",
    width: "full",
  },
  variants: {
    gutter: {
      compact: "p-4",
      default: "p-6",
      responsive: "p-4 sm:p-6",
    },
    width: {
      full: "",
      "3xl": "mx-auto max-w-3xl",
      "4xl": "mx-auto max-w-4xl",
      "5xl": "mx-auto max-w-5xl",
      "6xl": "mx-auto max-w-6xl",
    },
  },
});

type PageContainerProps = React.ComponentProps<"div"> &
  VariantProps<typeof pageContainerVariants> & {
    /**
     * Whether the page scrolls itself (default). The scroller is an outer element that fills its
     * parent, so a capped page keeps its scrollbar at the panel edge, not beside the column, and
     * the column is at least as tall as the panel (an empty state can still centre in it). Pass
     * `false` inside a parent that already scrolls.
     */
    scroll?: boolean;
  };

function PageContainer({
  className,
  gutter = "default",
  scroll = true,
  width = "full",
  ...props
}: PageContainerProps) {
  const frame = (
    <div
      className={cn(
        pageContainerVariants({ gutter, width }),
        scroll && "min-h-full",
        className,
      )}
      data-gutter={gutter}
      data-slot="page-container"
      data-width={width}
      {...props}
    />
  );
  if (!scroll) return frame;
  return (
    <div
      className="h-full w-full min-w-0 overflow-y-auto"
      data-slot="page-scroll"
    >
      {frame}
    </div>
  );
}

type PageHeaderProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** The page's name, rendered as the heading (the page's `h1` unless `headingLevel` says otherwise). */
  title: React.ReactNode;
  /** `id` of the heading, for a region's `aria-labelledby`. */
  titleId?: string;
  /** Heading level of the title. Default 1; a screen nested under another page's `h1` passes 2. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** One muted line under the title. */
  description?: React.ReactNode;
  /** Page-level actions, right-aligned beside the title. */
  actions?: React.ReactNode;
  /** A back link or breadcrumb trail above the title; pass the finished `nav` or link. */
  breadcrumbs?: React.ReactNode;
  /** Section tabs or meta shown under the title row. */
  tabs?: React.ReactNode;
};

/**
 * The one page title block (UX-1, DS-01), sized like General settings. For screens without a Kaneo
 * header-bar title (settings pages, God Mode, portal, detail sub-pages); a screen whose
 * `Layout.Header` already shows the title keeps that title and its hidden `h1` instead.
 */
function PageHeader({
  title,
  titleId,
  headingLevel = 1,
  description,
  actions,
  breadcrumbs,
  tabs,
  className,
  ...props
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-slot="page-header"
      {...props}
    >
      {breadcrumbs ? (
        <div data-slot="page-header-breadcrumbs">{breadcrumbs}</div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Heading
            className="break-words font-semibold text-2xl"
            data-slot="page-header-title"
            id={titleId}
          >
            {title}
          </Heading>
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
  type PageContainerProps,
  PageHeader,
  type PageHeaderProps,
  pageContainerVariants,
};

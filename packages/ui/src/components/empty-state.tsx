import { ToggleLeftIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "./button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";

type EmptyStateProps = Omit<React.ComponentProps<typeof Empty>, "title"> & {
  /** A decorative lucide icon; hidden from assistive technology. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** One next step, usually a `Button` (rendered as a link when it navigates). */
  action?: React.ReactNode;
};

/** The one empty-state look (UX-1, DS-02): icon, title, one line of copy, one action. */
function EmptyState({
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <Empty {...props}>
      <EmptyHeader>
        {icon ? (
          <EmptyMedia aria-hidden="true" variant="icon">
            {icon}
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

type FeatureOffAction = {
  label: React.ReactNode;
  /** The link element the button renders as, e.g. a router `Link` to the feature settings. */
  render: React.ReactElement;
};

type FeatureOffProps = Omit<EmptyStateProps, "action" | "description"> & {
  description: React.ReactNode;
  /** Pass only when the viewer can switch the feature on. */
  action?: FeatureOffAction;
};

/** The one "feature is switched off" state (UX-1, SR-02): never a dead end for an admin. */
function FeatureOff({
  icon = <ToggleLeftIcon />,
  action,
  ...props
}: FeatureOffProps) {
  return (
    <EmptyState
      data-feature-off=""
      icon={icon}
      action={
        action ? <Button render={action.render}>{action.label}</Button> : null
      }
      {...props}
    />
  );
}

export {
  EmptyState,
  type EmptyStateProps,
  FeatureOff,
  type FeatureOffAction,
  type FeatureOffProps,
};

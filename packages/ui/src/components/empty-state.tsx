import {
  LockIcon,
  RefreshCwIcon,
  ToggleLeftIcon,
  TriangleAlertIcon,
} from "lucide-react";
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
  /**
   * Level of the title heading. Default 2: the page's own title (`PageHeader`, or the header bar's
   * hidden `h1`) is the level-1 heading, so a state inside a page sits under it.
   */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  description?: React.ReactNode;
  /** One next step, usually a `Button` (rendered as a link when it navigates). */
  action?: React.ReactNode;
};

/** The one empty-state look (UX-1, DS-02): icon, title, one line of copy, one action. */
function EmptyState({
  icon,
  title,
  headingLevel = 2,
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
        <EmptyTitle level={headingLevel}>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/**
 * A button-styled action: either a link (`render` is the link element, e.g. a router `Link` to
 * the feature settings) or an in-page `onClick`, never both.
 */
type EmptyStateAction = {
  label: React.ReactNode;
} & (
  | { render: React.ReactElement; onClick?: never }
  | { onClick: () => void; render?: never }
);

type EmptyStateActionsProps = {
  /** The one next step. */
  action?: EmptyStateAction;
  /** A quieter second step, such as a way back. */
  secondaryAction?: EmptyStateAction;
};

function ActionButton({
  action,
  variant,
}: {
  action: EmptyStateAction;
  variant?: "outline";
}) {
  return (
    <Button onClick={action.onClick} render={action.render} variant={variant}>
      {action.label}
    </Button>
  );
}

/** The primary action, and beside it the secondary one when both are given. */
function actionsOf({ action, secondaryAction }: EmptyStateActionsProps) {
  if (action && secondaryAction)
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ActionButton action={action} />
        <ActionButton action={secondaryAction} variant="outline" />
      </div>
    );
  if (action) return <ActionButton action={action} />;
  if (secondaryAction)
    return <ActionButton action={secondaryAction} variant="outline" />;
  return null;
}

type FeatureOffProps = Omit<EmptyStateProps, "action" | "description"> &
  EmptyStateActionsProps & {
    description: React.ReactNode;
  };

/**
 * The one "feature is switched off" state (UX-1, SR-02): never a dead end for an admin. Pass
 * `action` only when the viewer can switch the feature on.
 */
function FeatureOff({
  icon = <ToggleLeftIcon />,
  action,
  secondaryAction,
  ...props
}: FeatureOffProps) {
  return (
    <EmptyState
      data-feature-off=""
      icon={icon}
      action={actionsOf({ action, secondaryAction })}
      {...props}
    />
  );
}

type NoAccessProps = Omit<EmptyStateProps, "action"> & EmptyStateActionsProps;

/**
 * The one "you cannot open this" state: a lock, what happened and whom to ask, and a way back.
 * The caller supplies the texts (translated), e.g. "You don't have access" / "Ask a workspace
 * admin." and a "Back" `action`.
 */
function NoAccess({
  icon = <LockIcon />,
  action,
  secondaryAction,
  ...props
}: NoAccessProps) {
  return (
    <EmptyState
      data-state="no-access"
      icon={icon}
      action={actionsOf({ action, secondaryAction })}
      {...props}
    />
  );
}

type ErrorStateProps = Omit<EmptyStateProps, "action"> &
  Pick<EmptyStateActionsProps, "secondaryAction"> & {
    /** Runs the failed read again. */
    onRetry: () => void;
    retryLabel: React.ReactNode;
  };

/**
 * The one "this could not load" state, with Retry. It is announced to assistive technology
 * (`role="alert"`), because it replaces content the viewer was waiting for.
 */
function ErrorState({
  icon = <TriangleAlertIcon />,
  onRetry,
  retryLabel,
  secondaryAction,
  ...props
}: ErrorStateProps) {
  return (
    <EmptyState
      data-state="error"
      icon={icon}
      role="alert"
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onRetry}>
            <RefreshCwIcon aria-hidden="true" />
            {retryLabel}
          </Button>
          {secondaryAction ? (
            <ActionButton action={secondaryAction} variant="outline" />
          ) : null}
        </div>
      }
      {...props}
    />
  );
}

export {
  EmptyState,
  type EmptyStateAction,
  type EmptyStateActionsProps,
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  FeatureOff,
  type FeatureOffProps,
  NoAccess,
  type NoAccessProps,
};

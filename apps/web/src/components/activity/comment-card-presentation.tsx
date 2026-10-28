import {
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  TimelineContent,
  TimelineItem,
} from "@taskdesk/ui";
import type { ComponentProps, ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

/** Original Kaneo comment card, shared independently of either comment API/controller. */
export function CommentCardPresentation({
  header,
  actions,
  footer,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  header: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      {...props}
      className={cn(
        "group relative w-full rounded-xl border border-border/80 bg-card/60",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        {header}
      </div>
      {actions ? (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
      <div className="pt-0.5">{children}</div>
      {footer}
    </div>
  );
}

/** Only caller-authorized profile fields belong here; no identity lookup or permission inference. */
export function ActivityActorPresentation({
  name,
  image,
  email,
  showAvatar = true,
}: {
  name: string;
  showAvatar?: boolean;
  image?: string | null;
  email?: string | null;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-2 px-0 py-0 font-medium text-foreground"
          />
        }
      >
        {showAvatar ? (
          <ActivityAvatarPresentation name={name} image={image} />
        ) : null}
        <span className="text-sm font-medium text-foreground">{name}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={image ?? ""} alt={name} />
            <AvatarFallback className="bg-muted text-xs font-medium">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-none text-foreground">
              {name}
            </p>
            {email ? (
              <p className="mt-1 text-xs text-muted-foreground">{email}</p>
            ) : null}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ActivityAvatarPresentation({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  return (
    <Avatar className="size-6">
      <AvatarImage src={image ?? ""} alt={name} />
      <AvatarFallback className="bg-muted text-[11px] font-medium">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Original Kaneo activity timeline row, independent of activity payload shape. */
export function ActivityEventPresentation({
  step,
  icon,
  avatar,
  actor,
  timestamp,
  showConnector,
  children,
}: {
  step: number;
  icon: ReactNode;
  avatar: ReactNode;
  actor: ReactNode;
  timestamp: ReactNode;
  showConnector?: boolean;
  children: ReactNode;
}) {
  return (
    <TimelineItem
      step={step}
      role="listitem"
      className="relative m-0! flex-row items-center gap-3 py-2.5!"
    >
      {showConnector ? (
        <span className="-translate-x-1/2 absolute top-9 bottom-0 left-3 w-px bg-[color-mix(in_srgb,var(--foreground)_18%,transparent)] dark:bg-[color-mix(in_srgb,var(--foreground)_26%,transparent)]" />
      ) : null}
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground">
        {icon}
      </span>
      {avatar}
      <TimelineContent className="text-sm leading-6 text-foreground">
        {actor} {children} {timestamp}
      </TimelineContent>
    </TimelineItem>
  );
}

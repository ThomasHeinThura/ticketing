import {
  Avatar,
  AvatarFallback,
  AvatarImage as DesignSystemAvatarImage,
} from "@taskdesk/ui";
import type * as React from "react";
import { resolveAvatarSrc } from "../lib/resolve-avatar-src";

type AvatarImageProps = React.ComponentProps<typeof DesignSystemAvatarImage>;

/** App adapter: API-relative avatar paths need the configured API origin. */
function AvatarImage({ src, ...props }: AvatarImageProps) {
  return (
    <DesignSystemAvatarImage
      src={typeof src === "string" ? resolveAvatarSrc(src) : src}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };

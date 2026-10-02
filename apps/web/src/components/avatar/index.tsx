"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage as SharedAvatarImage,
} from "@taskdesk/ui";
import type { ComponentProps } from "react";

import { resolveAvatarSrc } from "@/lib/resolve-avatar-src";

type AvatarImageProps = ComponentProps<typeof SharedAvatarImage>;

function AvatarImage({ src, ...props }: AvatarImageProps) {
  return (
    <SharedAvatarImage
      {...props}
      src={typeof src === "string" ? resolveAvatarSrc(src) : src}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };

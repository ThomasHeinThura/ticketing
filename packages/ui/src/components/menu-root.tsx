"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import * as React from "react";

const MenuCreateHandle = MenuPrimitive.createHandle;

const Menu = MenuPrimitive.Root;

function MenuTrigger({
  asChild = false,
  className,
  children,
  render,
  ...props
}: MenuPrimitive.Trigger.Props & { asChild?: boolean }) {
  const resolvedRender =
    asChild && React.isValidElement(children) ? children : render;

  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      render={resolvedRender}
      {...props}
    >
      {asChild ? undefined : children}
    </MenuPrimitive.Trigger>
  );
}

export {
  Menu,
  Menu as DropdownMenu,
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
};

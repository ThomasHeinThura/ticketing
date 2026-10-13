"use client";

import { Button, SidebarGroup } from "@taskdesk/ui";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SearchCommandMenu from "@/components/search-command-menu";
import { shortcuts } from "@/constants/shortcuts";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";

export default function Search() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useRegisterShortcuts({
    shortcuts: {
      [shortcuts.search.prefix]: () => {
        setOpen(true);
      },
    },
  });

  return (
    <SidebarGroup className="pb-1">
      <Button
        variant="ghost"
        className="inline-flex h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 py-1.5 text-foreground text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="flex grow items-center">
          <SearchIcon
            aria-hidden="true"
            className="-ms-1 me-3 text-muted-foreground"
            size={16}
          />
          <span className="font-normal text-muted-foreground">
            {t("navigation:commandPalette.search")}
          </span>
        </span>
        <kbd className="-me-0.5 ms-6 inline-flex h-4 max-h-full items-center rounded border border-border/70 bg-background px-1 font-[inherit] font-medium text-[0.625rem] text-muted-foreground">
          {shortcuts.search.prefix}
        </kbd>
      </Button>

      <SearchCommandMenu open={open} setOpen={setOpen} />
    </SidebarGroup>
  );
}

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "./command";

const items = ["Create work item", "Go to inbox", "Open settings"];

function KeepMountedCommandDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open command palette</Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup instant keepMounted>
          <Command items={["Projects", "Search", "Members"]}>
            <CommandInput aria-label="Search commands" />
            <CommandList>
              {(item: string) => (
                <CommandItem key={item} value={item}>
                  {item}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}

const meta = {
  title: "Primitives/Command",
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-80">
      <Command items={items}>
        <CommandInput aria-label="Search commands" />
        <CommandPanel>
          <CommandList>
            {(item: string) => (
              <CommandItem key={item}>
                {item}
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
            )}
          </CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandPanel>
      </Command>
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="w-80">
      <Command items={[]}>
        <CommandInput aria-label="Search commands" />
        <CommandPanel>
          <CommandList>
            {(item: string) => <CommandItem key={item}>{item}</CommandItem>}
          </CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandPanel>
      </Command>
    </div>
  ),
};

export const KeepMountedDialog: Story = {
  render: () => <KeepMountedCommandDialog />,
};

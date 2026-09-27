import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "./menu";

const meta = {
  title: "Primitives/Menu",
  component: Menu,
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Menu>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem>Rename</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuPopup>
    </Menu>
  ),
};

export const WithGroupsAndShortcuts: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger>File</MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>Document</MenuGroupLabel>
          <MenuItem>
            New
            <MenuShortcut>⌘N</MenuShortcut>
          </MenuItem>
          <MenuItem>
            Save
            <MenuShortcut>⌘S</MenuShortcut>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  ),
};

export const WithCheckboxAndRadioItems: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger>View</MenuTrigger>
      <MenuPopup>
        <MenuCheckboxItem checked>Show hidden files</MenuCheckboxItem>
        <MenuSeparator />
        <MenuRadioGroup defaultValue="list">
          <MenuRadioItem value="list">List</MenuRadioItem>
          <MenuRadioItem value="grid">Grid</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  ),
};

export const DisabledItem: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem>Rename</MenuItem>
        <MenuItem disabled>Duplicate</MenuItem>
      </MenuPopup>
    </Menu>
  ),
};

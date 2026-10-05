import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";

const meta = {
  title: "Primitives/Sidebar",
  component: Sidebar,
  args: {
    mobileTitle: "Main navigation",
    mobileDescription: "Navigate TaskDesk sections.",
    closeLabel: "Close navigation",
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <SidebarProvider>
      <Sidebar {...args} collapsible="icon">
        <SidebarHeader>
          <strong className="px-2 text-sm">TaskDesk</strong>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>Work items</SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Projects</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-3 p-4">
          <SidebarTrigger toggleLabel="Toggle navigation" />
          <h1 className="text-lg font-semibold">Work items</h1>
        </header>
      </SidebarInset>
    </SidebarProvider>
  ),
};

export const NativeScroll: Story = {
  render: (args) => (
    <SidebarProvider>
      <Sidebar {...args} collapsible="icon">
        <SidebarHeader>
          <strong className="px-2 text-sm">TaskDesk</strong>
        </SidebarHeader>
        <SidebarContent nativeScroll>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>Work items</SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Projects</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center gap-3 p-4">
          <SidebarTrigger toggleLabel="Toggle navigation" />
          <h1 className="text-lg font-semibold">Work items</h1>
        </header>
      </SidebarInset>
    </SidebarProvider>
  ),
};

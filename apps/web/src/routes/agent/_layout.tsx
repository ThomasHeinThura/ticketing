import { createFileRoute, Outlet } from "@tanstack/react-router";
import CommandPaletteLauncher from "@/components/command-palette/command-palette-launcher";

// layout for the main app
export const Route = createFileRoute("/_layout")({
  component: RouteComponent,
  codeSplitGroupings: [],
});

function RouteComponent() {
  return (
    <>
      <Outlet />
      <CommandPaletteLauncher />
    </>
  );
}

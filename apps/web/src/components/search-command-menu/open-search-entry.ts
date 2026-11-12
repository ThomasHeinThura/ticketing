import activateWorkspace from "@/fetchers/workspace/activate-workspace";
import { routes } from "@/lib/routes";
import type Workspace from "@/types/workspace";
import type { PaletteEntry } from "./search-targets";

type OpenPaletteEntryOptions = {
  entry: PaletteEntry;
  activeWorkspaceId?: string | null;
  workspaces?: readonly Pick<Workspace, "id">[];
  navigate: (options: { to: never }) => unknown;
  activate?: (workspaceId: string) => Promise<unknown>;
};

/**
 * Opens a search/palette entry at its canonical `/agent` destination. Workspace entries target
 * `/agent`, which renders the session's active workspace, so selecting a different authorized
 * workspace activates it first and refuses unauthorized workspace IDs.
 */
export async function openPaletteEntry({
  entry,
  activeWorkspaceId,
  workspaces,
  navigate,
  activate = activateWorkspace,
}: OpenPaletteEntryOptions): Promise<boolean> {
  if (entry.type !== "workspace") {
    await navigate({ to: entry.href as never });
    return true;
  }

  if (!entry.id) return false;

  if (activeWorkspaceId === entry.id) {
    await navigate({ to: routes.agentHome.path as never });
    return true;
  }

  if (
    workspaces &&
    !workspaces.some((workspace) => workspace.id === entry.id)
  ) {
    return false;
  }

  try {
    await activate(entry.id);
  } catch {
    return false;
  }

  await navigate({ to: routes.agentHome.path as never });
  return true;
}

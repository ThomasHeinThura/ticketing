import { activateWorkspaceForNavigation } from "@/lib/activate-workspace-for-navigation";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import type Workspace from "@/types/workspace";
import type { PaletteEntry } from "./search-targets";

type OpenPaletteEntryOptions = {
  entry: PaletteEntry;
  activeWorkspaceId?: string | null;
  workspaces?: readonly Pick<Workspace, "id">[];
  navigate: (options: { to: never }) => unknown;
  errorMessage: string;
  activate?: (workspaceId: string) => Promise<unknown>;
};

/**
 * Opens a search/palette entry at its canonical `/agent` destination. Workspace entries target
 * `/agent`, which renders the session's active workspace, so selecting a different authorized
 * workspace activates it first and surfaces a translated error toast on refusal or failure.
 */
export async function openPaletteEntry({
  entry,
  activeWorkspaceId,
  workspaces,
  navigate,
  errorMessage,
  activate = activateWorkspaceForNavigation,
}: OpenPaletteEntryOptions): Promise<boolean> {
  if (entry.type !== "workspace") {
    await navigate({ to: entry.href as never });
    return true;
  }

  if (!entry.id) {
    toast.error(errorMessage);
    return false;
  }

  if (
    workspaces &&
    !workspaces.some((workspace) => workspace.id === entry.id)
  ) {
    toast.error(errorMessage);
    return false;
  }

  if (activeWorkspaceId === entry.id) {
    await navigate({ to: routes.agentHome.path as never });
    return true;
  }

  try {
    await activate(entry.id);
  } catch {
    toast.error(errorMessage);
    return false;
  }

  await navigate({ to: routes.agentHome.path as never });
  return true;
}

type CreateDialogShellModule = typeof import("./work-item-create-dialog-shell");

let shellModulePromise: Promise<CreateDialogShellModule> | undefined;

/**
 * Loads the create dialog composition (Dialog, ScrollArea and their Base UI closure). The work
 * route does not need it to paint, so it is kept off the route's static graph (G11) and warmed
 * as soon as the create trigger is on screen, so the dialog still opens as soon as it is clicked.
 */
export function loadWorkItemCreateDialogShell(): Promise<CreateDialogShellModule> {
  if (!shellModulePromise) {
    shellModulePromise = import("./work-item-create-dialog-shell").catch(
      (error: unknown) => {
        shellModulePromise = undefined;
        throw error;
      },
    );
  }
  return shellModulePromise;
}

export function preloadWorkItemCreateDialogShell() {
  void loadWorkItemCreateDialogShell().catch(() => undefined);
}

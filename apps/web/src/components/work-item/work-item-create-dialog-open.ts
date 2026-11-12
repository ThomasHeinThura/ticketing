/**
 * Whether a work-item create dialog is already on screen (loading or open). The work route, the
 * project Overview and the command palette each mount their own dialog, so none of them can see
 * another's React state; this plain module counter is the one flag they share. The create
 * shortcut reads it so it does not stack a second dialog on one that is already up.
 */
let mountedDialogs = 0;

/** Marks one dialog mounted; call the returned function when it unmounts (safe to call twice). */
export function markWorkItemCreateDialogOpen(): () => void {
  mountedDialogs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedDialogs -= 1;
  };
}

export function isWorkItemCreateDialogOpen(): boolean {
  return mountedDialogs > 0;
}

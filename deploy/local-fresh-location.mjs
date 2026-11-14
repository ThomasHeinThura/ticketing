import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const inside = (parent, child) => {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith("../") && path !== ".." && !isAbsolute(path))
  );
};

// Volume driver options can map arbitrary host directories. Refuse those rather than
// assuming that Docker's reported volume mount point identifies the backing store.
export function assertBackupLocation({
  privateDir,
  composeEnv,
  checkout,
  volumes,
}) {
  const root = realpathSync(checkout);
  const directory = realpathSync(privateDir);
  const environment = realpathSync(composeEnv);
  const candidate = resolve(directory, "fresh-backups");
  const backupParent = existsSync(candidate)
    ? realpathSync(candidate)
    : candidate;
  if (
    inside(root, directory) ||
    inside(root, environment) ||
    inside(root, backupParent)
  )
    throw new Error("Private inputs must be outside the checkout.");
  for (const volume of volumes) {
    if (
      volume.Driver !== "local" ||
      !isAbsolute(volume.Mountpoint || "") ||
      Object.keys(volume.Options || {}).length
    )
      throw new Error("Volume storage independence cannot be established.");
    const mount = existsSync(volume.Mountpoint)
      ? realpathSync(volume.Mountpoint)
      : resolve(volume.Mountpoint);
    if (
      inside(mount, directory) ||
      inside(mount, environment) ||
      inside(mount, backupParent)
    )
      throw new Error("Private inputs are inside a selected volume.");
  }
}

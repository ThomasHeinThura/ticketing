import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertBackupLocation } from "../../deploy/local-fresh-location.mjs";

test("backup and private inputs cannot resolve into checkout or a selected volume", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "fresh-location-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkout = join(root, "checkout");
  const privateDir = join(root, "private");
  const volume = join(root, "volume");
  for (const dir of [checkout, privateDir, volume]) mkdirSync(dir);
  const composeEnv = join(privateDir, "env");
  writeFileSync(composeEnv, "");
  const volumes = [{ Driver: "local", Mountpoint: volume, Options: null }];
  assert.doesNotThrow(() =>
    assertBackupLocation({ privateDir, composeEnv, checkout, volumes }),
  );
  assert.throws(() =>
    assertBackupLocation({
      privateDir: checkout,
      composeEnv,
      checkout,
      volumes,
    }),
  );
  symlinkSync(volume, join(privateDir, "fresh-backups"));
  assert.throws(() =>
    assertBackupLocation({ privateDir, composeEnv, checkout, volumes }),
  );
  assert.throws(() =>
    assertBackupLocation({
      privateDir,
      composeEnv,
      checkout,
      volumes: [
        {
          Driver: "local",
          Mountpoint: volume,
          Options: { device: privateDir },
        },
      ],
    }),
  );
});

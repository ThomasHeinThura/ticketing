import { loadConfiguredSeedProfile } from "../apps/api/scripts/seed-cli.ts";

loadConfiguredSeedProfile()
  .then(({ runSeedCli }) => runSeedCli())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

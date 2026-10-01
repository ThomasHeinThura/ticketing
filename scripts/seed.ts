import("../apps/api/scripts/seed-profile.ts")
  .then(({ runSeedCli }) => runSeedCli())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });

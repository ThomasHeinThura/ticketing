import { runSitUserSeed } from "../apps/api/scripts/seed-sit-users.ts";

runSitUserSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

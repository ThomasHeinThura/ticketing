import { runUatSeed } from "../apps/api/scripts/seed-uat-users.ts";

runUatSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

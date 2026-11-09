import { describeSeedError, runDemoSeed } from "./seed-demo-data.ts";

runDemoSeed().catch((error) => {
  // Never the error object: a database error carries the statement's parameters.
  console.error(describeSeedError(error));
  process.exitCode = 1;
});

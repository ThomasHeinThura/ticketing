import { runDemoSeed } from "./seed-demo-data.ts";

runDemoSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

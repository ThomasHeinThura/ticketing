import { config } from "dotenv-mono";
import { type Config, defineConfig } from "drizzle-kit";
import { resolveDatabaseConnectionString } from "./src/database/resolve-database-url";

config();

export default defineConfig({
  out: "./drizzle",
  schema: [
    "./src/database/schema.ts",
    "./src/database/migration-schema.ts",
    "./src/permissions/shadow-schema.ts",
    "./src/database/schema-p5-agile.ts",
    "./src/database/schema-p5-time.ts",
    "./src/database/schema-p5-kb.ts",
    "./src/database/schema-p5-service.ts",
    "./src/database/schema-p5-reports.ts",
    "./src/database/schema-p5-invite.ts",
    "./src/database/schema-p5-pages.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDatabaseConnectionString(),
  },
}) satisfies Config;

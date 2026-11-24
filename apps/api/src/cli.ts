import {
  breakGlassGrantInstanceAdmin,
  parseCliArgs,
} from "./instance/users/break-glass";

const parsed = parseCliArgs(process.argv.slice(2));
if ("error" in parsed) {
  console.error(parsed.error);
  process.exit(2);
}
try {
  const outcome = await breakGlassGrantInstanceAdmin(parsed.email);
  console.log(`grant-instance-admin: ${outcome}`);
  process.exit(0);
} catch (error) {
  console.error(
    `grant-instance-admin failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

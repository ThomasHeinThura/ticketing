import { eq } from "drizzle-orm";
import db, { schema } from "../database";
import { staffRegistrationDisabledByEnvironment } from "../utils/check-registration-allowed";

// Defaults closed until the initial configuration load has succeeded.
let storedStaffSelfRegistration = false;

export async function refreshStaffRegistration(): Promise<void> {
  try {
    const [setting] = await db
      .select({
        enabled: schema.instanceSettingTable.staffSelfRegistrationEnabled,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .limit(1);
    storedStaffSelfRegistration = setting?.enabled === true;
  } catch (error) {
    storedStaffSelfRegistration = false;
    throw error;
  }
}

export function staffSelfRegistrationEnabled(): boolean {
  return (
    !staffRegistrationDisabledByEnvironment() && storedStaffSelfRegistration
  );
}

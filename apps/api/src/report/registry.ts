import { agileReports } from "./reports/agile";
import { customerReports } from "./reports/customers";
import { deliveryReports } from "./reports/delivery";
import { kbReports } from "./reports/kb";
import { leadershipReports } from "./reports/leadership";
import { peopleReports } from "./reports/people";
import { promiseReports } from "./reports/promises";
import { timeReports } from "./reports/time";
import type { ReportDefinition } from "./types";

/** The tier 1 reports (RP, "The reports"), plus the cycle, time and knowledge base reports. */
export const REPORTS: readonly ReportDefinition[] = [
  ...promiseReports,
  ...customerReports,
  ...deliveryReports,
  ...peopleReports,
  ...leadershipReports,
  ...agileReports,
  ...timeReports,
  ...kbReports,
];

const BY_KEY = new Map(REPORTS.map((report) => [report.key, report]));

export function reportByKey(key: string): ReportDefinition | undefined {
  return BY_KEY.get(key);
}

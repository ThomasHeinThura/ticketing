export type BreakGlassOperatorIdentity = {
  uid: number;
  passwdName: "taskdesk";
};

export function resolveBreakGlassOperatorIdentity(input: {
  passwdContents: string;
  effectiveUid: number | undefined;
  reportedUid: number;
  reportedUsername: string;
}): BreakGlassOperatorIdentity {
  const serviceRows = input.passwdContents
    .split("\n")
    .map((line) => line.split(":"))
    .filter((fields) => fields[0] === "taskdesk");
  const configuredUid = Number(serviceRows[0]?.[2]);
  if (
    serviceRows.length !== 1 ||
    !Number.isSafeInteger(configuredUid) ||
    configuredUid < 1 ||
    input.effectiveUid !== configuredUid ||
    input.reportedUid !== configuredUid ||
    input.reportedUsername !== "taskdesk"
  ) {
    throw new Error(
      "The effective process identity does not match the TaskDesk service account.",
    );
  }
  return { uid: configuredUid, passwdName: "taskdesk" };
}

import type { ResolvedIdentity } from "@taskdesk/permissions";
import { findLabelsByTaskId } from "../repository";

async function getLabelsByTaskId(identity: ResolvedIdentity, taskId: string) {
  const labels = await findLabelsByTaskId(identity, taskId);

  return labels;
}

export default getLabelsByTaskId;

import { findLabelsByTaskId } from "../repository";

async function getLabelsByTaskId(taskId: string) {
  const labels = await findLabelsByTaskId(taskId);

  return labels;
}

export default getLabelsByTaskId;

import { listLabelsByTaskQuery } from "../repository";

async function getLabelsByTaskId(taskId: string) {
  const labels = await listLabelsByTaskQuery(taskId);

  return labels;
}

export default getLabelsByTaskId;

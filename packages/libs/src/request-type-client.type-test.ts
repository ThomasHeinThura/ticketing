import type {
  CreateRequestTypeInput,
  RequestTypeDto,
  RequestTypeListDto,
} from "@taskdesk/api";
import { requestTypeClient } from "./hono";

const createInput: CreateRequestTypeInput = {
  workspaceId: "workspace-id",
  name: "Access request",
  group: "IT",
  workItemTypeId: "type-id",
  formSchema: { fields: [] },
};

const created: Promise<RequestTypeDto> = requestTypeClient.create(createInput);
const listed: Promise<RequestTypeListDto> = requestTypeClient.list({
  workspaceId: "workspace-id",
});
const updated: Promise<RequestTypeDto> = requestTypeClient.update("type-id", {
  name: "Updated name",
});

// Published keys are server-generated and must not be accepted as create input.
// @ts-expect-error request type keys are not client-writable
requestTypeClient.create({ ...createInput, key: "caller-chosen-key" });
// @ts-expect-error update accepts only declared request-type fields
requestTypeClient.update("type-id", { workspaceId: "other-workspace" });

void [created, listed, updated];

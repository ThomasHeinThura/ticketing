import { client } from "@taskdesk/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type ServiceCalendar = InferResponseType<
  (typeof client)["service-calendars"]["$get"],
  200
>[number];
export type ServiceCalendarPreview = InferResponseType<
  (typeof client)["service-calendars"][":id"]["preview"]["$get"],
  200
>;
export type ServiceCalendarInput = Omit<
  ServiceCalendar,
  "id" | "workspaceId" | "createdAt" | "updatedAt" | "version"
>;
export type CreateServiceCalendarRequest = ServiceCalendarInput & {
  workspaceId: string;
};
export type UpdateServiceCalendarRequest = {
  id: string;
  version: number;
  data: ServiceCalendarInput;
};

export class ServiceCalendarConflictError extends HttpError {
  constructor(
    message: string,
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(409, message);
    this.name = "ServiceCalendarConflictError";
  }
}
export type Holiday = ServiceCalendar["holidays"][number];
export type CalendarWindow = NonNullable<
  ServiceCalendar["windows"][keyof ServiceCalendar["windows"]]
>[number];
export type Weekday = keyof ServiceCalendar["windows"];

export async function getServiceCalendars(
  workspaceId: string,
): Promise<ServiceCalendar[]> {
  const response = await client["service-calendars"].$get({
    query: { workspaceId },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load service calendars");
  }

  return response.json();
}

export async function getServiceCalendar(id: string): Promise<ServiceCalendar> {
  const response = await client["service-calendars"][":id"].$get({
    param: { id },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to load service calendar");
  }

  return response.json();
}

export async function getServiceCalendarPreview(
  id: string,
  year: number,
): Promise<ServiceCalendarPreview> {
  const response = await client["service-calendars"][":id"].preview.$get({
    param: { id },
    query: { year: String(year) },
  });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      "Failed to calculate calendar preview",
    );
  }

  return response.json();
}

export async function createServiceCalendar(
  data: CreateServiceCalendarRequest,
): Promise<ServiceCalendar> {
  const response = await client["service-calendars"].$post({ json: data });

  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(response.status, detail || "Failed to create calendar");
  }

  return response.json();
}

export async function updateServiceCalendar({
  id,
  version,
  data,
}: UpdateServiceCalendarRequest): Promise<ServiceCalendar> {
  const response = await client["service-calendars"][":id"].$patch({
    param: { id },
    header: { "if-match": `"${version}"` },
    json: data,
  });

  if (!response.ok) {
    if (response.status === 409) {
      const conflict = (await response.json()) as {
        message?: string;
        assertedVersion?: number;
        currentVersion?: number;
      };
      throw new ServiceCalendarConflictError(
        conflict.message ?? "Calendar changed since it was loaded",
        conflict.assertedVersion ?? version,
        conflict.currentVersion ?? version,
      );
    }
    const detail = await response.text();
    throw new HttpError(response.status, detail || "Failed to save calendar");
  }

  return response.json();
}

export type GetServiceCalendarsRequest = InferRequestType<
  (typeof client)["service-calendars"]["$get"]
>;

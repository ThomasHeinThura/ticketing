import { client } from "@taskdesk/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type ServiceCalendar = InferResponseType<
  (typeof client)["service-calendars"]["$get"],
  200
>["data"][number];
export type ServiceCalendarPage = InferResponseType<
  (typeof client)["service-calendars"]["$get"],
  200
>;
export type HolidayImportResponse = {
  calendar: ServiceCalendar;
  importedCount: number;
  duplicateCount: number;
};
export type ServiceCalendarPreview = InferResponseType<
  (typeof client)["service-calendars"][":id"]["preview"]["$get"],
  200
>;
export type ServiceCalendarUsage = InferResponseType<
  (typeof client)["service-calendars"][":id"]["usage"]["$get"],
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
  cursor?: string,
): Promise<ServiceCalendarPage> {
  const response = await client["service-calendars"].$get({
    query: { workspaceId, cursor, limit: "50" },
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

export async function getServiceCalendarUsage(
  id: string,
): Promise<ServiceCalendarUsage> {
  const response = await client["service-calendars"][":id"].usage.$get({
    param: { id },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Failed to load calendar usage");
  return response.json();
}

export async function requestServiceCalendarDeletion(id: string) {
  const response = await client["service-calendars"][":id"].$delete({
    param: { id },
  });
  if (!response.ok)
    throw new HttpError(response.status, "Unable to request calendar deletion");
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

export async function importServiceCalendarHolidays(input: {
  id: string;
  version: number;
  ics: string;
}): Promise<HolidayImportResponse> {
  const response = await client["service-calendars"][
    ":id"
  ].holidays.import.$post({
    param: { id: input.id },
    header: { "if-match": `"${input.version}"` },
    json: { ics: input.ics },
  });
  if (!response.ok) {
    const detail = await response.text();
    let message = detail;
    try {
      const problem = JSON.parse(detail) as {
        message?: unknown;
        detail?: unknown;
      };
      if (typeof problem.message === "string") message = problem.message;
      else if (typeof problem.detail === "string") message = problem.detail;
    } catch {
      // Keep a plain-text response when the server did not return a problem document.
    }
    if (response.status === 409) {
      let conflict: {
        message?: string;
        assertedVersion?: number;
        currentVersion?: number;
      } = {};
      try {
        conflict = JSON.parse(detail) as typeof conflict;
      } catch {
        /* The plain-text detail remains available. */
      }
      throw new ServiceCalendarConflictError(
        conflict.message ?? "Calendar changed since it was loaded",
        conflict.assertedVersion ?? input.version,
        conflict.currentVersion ?? input.version,
      );
    }
    throw new HttpError(
      response.status,
      message || "Failed to import holidays",
    );
  }
  return response.json();
}

export type GetServiceCalendarsRequest = InferRequestType<
  (typeof client)["service-calendars"]["$get"]
>;

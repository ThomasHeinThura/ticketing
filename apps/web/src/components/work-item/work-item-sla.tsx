import { Badge, Label, Switch } from "@taskdesk/ui";
import { useState } from "react";

function WorkItemSlaPanel({ workItemKey }: { workItemKey: string }) {
  const [pausedOnCustomerWait, setPausedOnCustomerWait] = useState(false);
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="work-item-sla-heading"
      data-testid="work-item-sla"
    >
      {" "}
      <h2 id="work-item-sla-heading" className="font-medium text-lg">
        {" "}
        SLA targets{" "}
      </h2>{" "}
      <div className="flex flex-col gap-3 rounded-md border p-4 text-sm">
        {" "}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {" "}
          <span className=""> First Response ({workItemKey}) </span>{" "}
          <Badge variant={pausedOnCustomerWait ? "secondary" : "success"}>
            {" "}
            {pausedOnCustomerWait
              ? "Paused · 1h 45m remaining"
              : "On track · 1h 45m remaining"}{" "}
          </Badge>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {" "}
          <span className="">Resolution target</span>{" "}
          <Badge variant={pausedOnCustomerWait ? "secondary" : "success"}>
            {" "}
            {pausedOnCustomerWait
              ? "Paused · 6h 20m remaining"
              : "On track · 6h 20m remaining"}{" "}
          </Badge>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {" "}
          <span className="">Bound calendar</span>{" "}
          <span className="font-medium">
            {" "}
            Business Hours (Mon–Fri 09:00–17:00){" "}
          </span>{" "}
        </div>{" "}
        <div className="flex items-center gap-2">
          {" "}
          <Switch
            id={`sla-pause-switch-${workItemKey}`}
            aria-label="Pause SLA clock for customer wait state"
            checked={pausedOnCustomerWait}
            onCheckedChange={(checked) =>
              setPausedOnCustomerWait(Boolean(checked))
            }
          />{" "}
          <Label htmlFor={`sla-pause-switch-${workItemKey}`}>
            {" "}
            {pausedOnCustomerWait
              ? "SLA paused on customer wait"
              : "Pause SLA on customer wait"}{" "}
          </Label>{" "}
        </div>{" "}
      </div>{" "}
    </section>
  );
}
export default WorkItemSlaPanel;

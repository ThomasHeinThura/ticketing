import { createFileRoute } from "@tanstack/react-router";
import { PortalUnavailableNotice } from "./__root";

export const Route = createFileRoute("/")({
  component: PortalUnavailableNotice,
});

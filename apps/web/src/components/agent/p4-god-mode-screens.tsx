import { Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Switch,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import PageTitle from "@/components/page-title";

type GodModeSectionItem = { label: string; to: string; description: string };
const GOD_MODE_SECTIONS: GodModeSectionItem[] = [
  {
    label: "Overview",
    to: "/agent/god-mode",
    description:
      "Instance health, runtime services, and security posture summary.",
  },
  {
    label: "General",
    to: "/agent/god-mode/general",
    description:
      "Instance display name, public origins, timezone, and terminology.",
  },
  {
    label: "Branding",
    to: "/agent/god-mode/branding",
    description: "Product title, logo URL, portal subtitle, and theme presets.",
  },
  {
    label: "Authentication",
    to: "/agent/god-mode/auth",
    description:
      "Identity providers, session policies, and SSO assertion boundaries.",
  },
  {
    label: "Organisations",
    to: "/agent/god-mode/organisations",
    description: "Tenant workspaces, isolation boundaries, and domain routing.",
  },
  {
    label: "Users",
    to: "/agent/god-mode/users",
    description:
      "Instance-wide user directory, role assignments, and privilege controls.",
  },
  {
    label: "Storage",
    to: "/agent/god-mode/storage",
    description:
      "Attachment storage backend drivers, size limits, and MIME allowlist.",
  },
  {
    label: "Notifications",
    to: "/agent/god-mode/notifications",
    description:
      "Transactional email relay status, sender address, and rate limits.",
  },
  {
    label: "Deliveries",
    to: "/agent/god-mode/deliveries",
    description:
      "Instance outbox and dead-letter queue inspector across all channels.",
  },
  {
    label: "Features",
    to: "/agent/god-mode/features",
    description: "Instance-wide runtime feature flags and capability switches.",
  },
  {
    label: "Jobs",
    to: "/agent/god-mode/jobs",
    description:
      "Background job schedulers, worker cadences, and manual dispatch.",
  },
  {
    label: "Plugins",
    to: "/agent/god-mode/plugins",
    description:
      "Registered plugin contracts, contract versions, and health status.",
  },
  {
    label: "MCP",
    to: "/agent/god-mode/mcp",
    description:
      "Model Context Protocol server governance, scopes, and tool audit log.",
  },
  {
    label: "Audit",
    to: "/agent/god-mode/audit",
    description:
      "Immutable instance administration and privileged action audit log.",
  },
];
export function GodModeSectionNav({ activePath }: { activePath: string }) {
  return (
    <nav
      aria-label="God Mode sections"
      className="flex flex-wrap items-center gap-2 border rounded-md p-3"
    >
      {" "}
      {GOD_MODE_SECTIONS.map((section) => {
        const isActive = activePath === section.to;
        return (
          <Link key={section.to} to={section.to as never}>
            {" "}
            <Button
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
            >
              {" "}
              {section.label}{" "}
            </Button>{" "}
          </Link>
        );
      })}{" "}
    </nav>
  );
}
export function GodModeHomeScreen() {
  const [lastRefreshed, setLastRefreshed] = useState("2026-10-20 08:10:00 UTC");
  const [maintenanceBanner, setMaintenanceBanner] = useState(false);
  const healthMetrics = [
    {
      service: "PostgreSQL",
      status: "Healthy",
      detail:
        "Primary read/write pool · 4.2ms p95 latency · 18/100 connections",
    },
    {
      service: "Valkey",
      status: "Healthy",
      detail:
        "In-memory session & queue broker · 0.8ms latency · 99.4% hit rate",
    },
    {
      service: "Background Workers",
      status: "Active",
      detail: "5/5 scheduled workers heartbeating · 0 stalled jobs",
    },
    {
      service: "Storage Volume",
      status: "Mounted",
      detail:
        "/var/lib/taskdesk · 41.2 GB free of 100 GB · read/write verified",
    },
  ];
  const navSections = GOD_MODE_SECTIONS.filter(
    (section) => section.to !== "/agent/god-mode",
  );
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Instance Health" />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <div className="flex items-center gap-2">
            {" "}
            <h1 className="text-2xl font-semibold"> God Mode home / health </h1>{" "}
            <Badge variant="outline">instance:admin</Badge>{" "}
          </div>{" "}
          <p className="text-sm">
            {" "}
            Self-hosted instance runtime status, security posture, and global
            configuration surfaces.{" "}
          </p>{" "}
        </div>{" "}
        <div className="flex items-center gap-3">
          {" "}
          <span className="text-xs font-mono"> Checked: {lastRefreshed} </span>{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => setLastRefreshed("2026-10-20 08:15:42 UTC")}
          >
            {" "}
            Refresh health checks{" "}
          </Button>{" "}
        </div>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode" />{" "}
      <section
        aria-label="Instance health summary"
        className="grid gap-4 md:grid-cols-2"
      >
        {" "}
        {healthMetrics.map((metric) => (
          <Card key={metric.service}>
            {" "}
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              {" "}
              <div className="space-y-1">
                {" "}
                <CardTitle className="text-base">{metric.service}</CardTitle>{" "}
                <CardDescription>{metric.detail}</CardDescription>{" "}
              </div>{" "}
              <Badge variant="success">{metric.status}</Badge>{" "}
            </CardHeader>{" "}
          </Card>
        ))}{" "}
      </section>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Instance security posture summary
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Enforced runtime guards across identity providers, tenant
            boundaries, and destructive operations.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <Card>
            <CardContent className="py-3 space-y-1">
              {" "}
              <p className="font-semibold text-sm">
                Zero implicit privilege escalation enforced
              </p>{" "}
              <p className="text-xs">
                {" "}
                SSO and SCIM claims cannot grant instance:admin or sees_all.
                Destructive operations require dual-custody pending action
                approval (PA-1).{" "}
              </p>{" "}
            </CardContent>
          </Card>{" "}
          <div className="grid gap-4 md:grid-cols-3">
            {" "}
            <div className="border rounded-md p-4 space-y-1">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <span className="text-sm font-medium">
                  Route policy coverage
                </span>{" "}
                <Badge variant="success">100% verified</Badge>{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                All registered API and web routes enforce explicit capability
                checks.{" "}
              </p>{" "}
            </div>{" "}
            <div className="border rounded-md p-4 space-y-1">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <span className="text-sm font-medium">
                  Pending action guard (PA-1)
                </span>{" "}
                <Badge variant="info">Active</Badge>{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                Tenant deletion, role elevation, and MCP write actions require
                explicit confirmation.{" "}
              </p>{" "}
            </div>{" "}
            <div className="border rounded-md p-4 space-y-2">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <Label
                  htmlFor="maintenance-advisory-toggle"
                  className="text-sm font-medium"
                >
                  {" "}
                  Maintenance advisory banner{" "}
                </Label>{" "}
                <Switch
                  id="maintenance-advisory-toggle"
                  aria-label="Maintenance advisory banner"
                  checked={maintenanceBanner}
                  onCheckedChange={(checked) =>
                    setMaintenanceBanner(Boolean(checked))
                  }
                />{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                {maintenanceBanner
                  ? "Advisory banner displayed to active agent and portal sessions."
                  : "Normal operation; no maintenance banner shown."}{" "}
              </p>{" "}
            </div>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <section
        aria-label="God Mode configuration sections"
        className="space-y-3"
      >
        {" "}
        <h2 className="text-lg font-semibold">
          {" "}
          God Mode administration sections{" "}
        </h2>{" "}
        <div className="grid gap-4 md:grid-cols-3">
          {" "}
          {navSections.map((section) => (
            <Card key={section.to}>
              {" "}
              <CardHeader>
                {" "}
                <CardTitle className="text-base">{section.label}</CardTitle>{" "}
                <CardDescription>{section.description}</CardDescription>{" "}
              </CardHeader>{" "}
              <CardContent>
                {" "}
                <Link to={section.to as never}>
                  {" "}
                  <Button type="button" variant="outline" size="sm">
                    {" "}
                    Open {section.label}{" "}
                  </Button>{" "}
                </Link>{" "}
              </CardContent>{" "}
            </Card>
          ))}{" "}
        </div>{" "}
      </section>{" "}
    </main>
  );
}
export function GodModeGeneralScreen() {
  const [instanceName, setInstanceName] = useState(
    "TaskDesk Production Instance",
  );
  const [agentOrigin, setAgentOrigin] = useState("https://desk.example.org");
  const [portalOrigin, setPortalOrigin] = useState(
    "https://support.example.org",
  );
  const [defaultTimezone, setDefaultTimezone] = useState("UTC");
  const [defaultLocale, setDefaultLocale] = useState("en-GB");
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState("60");
  const [ticketTermSingular, setTicketTermSingular] = useState("Ticket");
  const [ticketTermPlural, setTicketTermPlural] = useState("Tickets");
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · General" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          General instance configuration{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Configure instance display name, public origins, regional defaults,
          session timeout, and terminology overrides.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/general" />{" "}
      {savedStatus ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Configuration saved</p>{" "}
            <p className="text-xs">{savedStatus}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Instance identity & public origins
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Runtime origins used for callback validation, email links, and
            portal routing.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="grid gap-4 md:grid-cols-2">
          {" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-instance-name">Instance display name</Label>{" "}
            <Input
              id="gm-instance-name"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-session-timeout">
              Session idle timeout (minutes)
            </Label>{" "}
            <Input
              id="gm-session-timeout"
              type="number"
              value={idleTimeoutMinutes}
              onChange={(e) => setIdleTimeoutMinutes(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-agent-origin">Public agent origin</Label>{" "}
            <Input
              id="gm-agent-origin"
              value={agentOrigin}
              onChange={(e) => setAgentOrigin(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-portal-origin">Public portal origin</Label>{" "}
            <Input
              id="gm-portal-origin"
              value={portalOrigin}
              onChange={(e) => setPortalOrigin(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-default-timezone">Default timezone</Label>{" "}
            <Input
              id="gm-default-timezone"
              value={defaultTimezone}
              onChange={(e) => setDefaultTimezone(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="gm-default-locale">Default locale</Label>{" "}
            <Input
              id="gm-default-locale"
              value={defaultLocale}
              onChange={(e) => setDefaultLocale(e.target.value)}
            />{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Instance-default terminology overrides
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Customise the default noun used across agent queues and customer
            portal views.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="gm-term-singular">Work item singular label</Label>{" "}
              <Input
                id="gm-term-singular"
                value={ticketTermSingular}
                onChange={(e) => setTicketTermSingular(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="gm-term-plural">Work item plural label</Label>{" "}
              <Input
                id="gm-term-plural"
                value={ticketTermPlural}
                onChange={(e) => setTicketTermPlural(e.target.value)}
              />{" "}
            </div>{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center justify-between gap-4">
            {" "}
            <span className="text-xs">
              {" "}
              Changes take effect immediately across all workspaces without
              container restart.{" "}
            </span>{" "}
            <Button
              type="button"
              onClick={() =>
                setSavedStatus(
                  `Saved general settings for"${instanceName}" (${defaultTimezone}, ${defaultLocale}, idle timeout ${idleTimeoutMinutes}m).`,
                )
              }
            >
              {" "}
              Save general settings{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeBrandingScreen() {
  const [productTitle, setProductTitle] = useState("TaskDesk Service Desk");
  const [logoUrl, setLogoUrl] = useState(
    "https://assets.example.org/brand/taskdesk-mark.svg",
  );
  const [portalSubtitle, setPortalSubtitle] = useState(
    "Submit requests, track SLA milestones, and review resolution updates.",
  );
  const [supportEmail, setSupportEmail] = useState("helpdesk@example.org");
  const [themePreset, setThemePreset] = useState<
    "Default Neutral" | "High Contrast"
  >("Default Neutral");
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Branding" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Instance branding configuration{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Manage product title, logo asset URL, customer portal header copy,
          support contact, and accessibility theme preset.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/branding" />{" "}
      {savedBanner ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Branding updated</p>{" "}
            <p className="text-xs">{savedBanner}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Brand identity & portal header
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Runtime branding stored in PostgreSQL; one container image serves
            every tenant.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="branding-product-title">Product title</Label>{" "}
              <Input
                id="branding-product-title"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="branding-logo-url">Logo URL</Label>{" "}
              <Input
                id="branding-logo-url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="branding-support-email">
                Support contact email
              </Label>{" "}
              <Input
                id="branding-support-email"
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <span className="text-sm font-medium">Theme preset selector</span>{" "}
              <div className="flex flex-wrap items-center gap-2">
                {" "}
                <Button
                  type="button"
                  variant={
                    themePreset === "Default Neutral" ? "default" : "outline"
                  }
                  onClick={() => setThemePreset("Default Neutral")}
                >
                  {" "}
                  Default Neutral{" "}
                </Button>{" "}
                <Button
                  type="button"
                  variant={
                    themePreset === "High Contrast" ? "default" : "outline"
                  }
                  onClick={() => setThemePreset("High Contrast")}
                >
                  {" "}
                  High Contrast{" "}
                </Button>{" "}
              </div>{" "}
            </div>{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="branding-portal-subtitle">
              Portal header subtitle
            </Label>{" "}
            <Textarea
              id="branding-portal-subtitle"
              value={portalSubtitle}
              onChange={(e) => setPortalSubtitle(e.target.value)}
            />{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center justify-between gap-4">
            {" "}
            <div className="flex items-center gap-2">
              {" "}
              <span className="text-xs">Active preset:</span>{" "}
              <Badge variant="outline">{themePreset}</Badge>{" "}
            </div>{" "}
            <Button
              type="button"
              onClick={() =>
                setSavedBanner(
                  `Saved branding"${productTitle}" with ${themePreset} preset and contact ${supportEmail}.`,
                )
              }
            >
              {" "}
              Save branding{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeStorageScreen() {
  const [activeDriver, setActiveDriver] = useState<
    "Local volume /var/lib/taskdesk" | "S3-Compatible Object Storage"
  >("Local volume /var/lib/taskdesk");
  const [maxUploadMb, setMaxUploadMb] = useState("25");
  const [allowedMimes, setAllowedMimes] = useState(
    "application/pdf, image/png, image/jpeg, text/plain, application/zip",
  );
  const [s3Endpoint, setS3Endpoint] = useState(
    "https://s3.eu-central-1.amazonaws.com",
  );
  const [s3Bucket, setS3Bucket] = useState("taskdesk-prod-attachments");
  const [storageTestResult, setStorageTestResult] = useState<string | null>(
    null,
  );
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Storage" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Attachment storage backend settings{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Configure active storage driver, upload size ceilings, MIME
          allowlists, and verify write integrity.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/storage" />{" "}
      {storageTestResult ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Storage probe completed</p>{" "}
            <p className="text-xs">{storageTestResult}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">Active storage driver</CardTitle>{" "}
          <CardDescription>
            {" "}
            Select the primary attachment persistence driver for ticket comments
            and knowledge articles.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex flex-wrap items-center gap-3">
            {" "}
            <Button
              type="button"
              variant={
                activeDriver === "Local volume /var/lib/taskdesk"
                  ? "default"
                  : "outline"
              }
              onClick={() => setActiveDriver("Local volume /var/lib/taskdesk")}
            >
              {" "}
              Local volume /var/lib/taskdesk{" "}
            </Button>{" "}
            <Button
              type="button"
              variant={
                activeDriver === "S3-Compatible Object Storage"
                  ? "default"
                  : "outline"
              }
              onClick={() => setActiveDriver("S3-Compatible Object Storage")}
            >
              {" "}
              S3-Compatible Object Storage{" "}
            </Button>{" "}
            <Badge variant="info">{activeDriver}</Badge>{" "}
          </div>{" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="storage-max-upload-mb">
                Max upload size (MB)
              </Label>{" "}
              <Input
                id="storage-max-upload-mb"
                type="number"
                value={maxUploadMb}
                onChange={(e) => setMaxUploadMb(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="storage-s3-bucket">Target bucket / subpath</Label>{" "}
              <Input
                id="storage-s3-bucket"
                value={s3Bucket}
                onChange={(e) => setS3Bucket(e.target.value)}
              />{" "}
            </div>{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="storage-s3-endpoint">
              S3-compatible endpoint URL
            </Label>{" "}
            <Input
              id="storage-s3-endpoint"
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
            />{" "}
          </div>{" "}
          <div className="space-y-2">
            {" "}
            <Label htmlFor="storage-allowed-mimes">Allowed MIME types</Label>{" "}
            <Textarea
              id="storage-allowed-mimes"
              value={allowedMimes}
              onChange={(e) => setAllowedMimes(e.target.value)}
            />{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {" "}
            <span className="text-xs">
              {" "}
              Executable binaries and HTML uploads are rejected before streaming
              to storage.{" "}
            </span>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setStorageTestResult(
                    `Write/read/delete probe succeeded on"${activeDriver}" (max ${maxUploadMb} MB, SHA-256 verified in 14ms).`,
                  )
                }
              >
                {" "}
                Test storage write{" "}
              </Button>{" "}
              <Button
                type="button"
                onClick={() =>
                  setStorageTestResult(
                    `Saved storage policy (${activeDriver}, ${maxUploadMb} MB limit).`,
                  )
                }
              >
                {" "}
                Save storage settings{" "}
              </Button>{" "}
            </div>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeNotificationsScreen() {
  const [smtpHost, setSmtpHost] = useState("smtp.eu.mailgun.org:587");
  const [senderAddress, setSenderAddress] = useState(
    "notifications@desk.example.org",
  );
  const [rateLimitPerWorkspace, setRateLimitPerWorkspace] = useState("600");
  const [testRecipient, setTestRecipient] = useState("admin@example.org");
  const [tlsEnforced, setTlsEnforced] = useState(true);
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Notifications" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Instance notification channels{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Configure SMTP / transactional email relay settings, sender identity,
          workspace rate limits, and test dispatch.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/notifications" />{" "}
      {dispatchMessage ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Notification relay update</p>{" "}
            <p className="text-xs">{dispatchMessage}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          {" "}
          <div className="space-y-1">
            {" "}
            <CardTitle className="text-lg">
              SMTP / transactional email relay status
            </CardTitle>{" "}
            <CardDescription>
              {" "}
              Outbound email transport managed through
              @taskdesk/plugin-email-smtp with outbox retry guarantees.{" "}
            </CardDescription>{" "}
          </div>{" "}
          <Badge variant="success">Relay connected</Badge>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="grid gap-4 md:grid-cols-2">
            {" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="notif-smtp-host">SMTP relay host & port</Label>{" "}
              <Input
                id="notif-smtp-host"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="notif-sender-address">Sender address</Label>{" "}
              <Input
                id="notif-sender-address"
                type="email"
                value={senderAddress}
                onChange={(e) => setSenderAddress(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="notif-rate-limit">
                {" "}
                Rate limit per workspace (emails / hour){" "}
              </Label>{" "}
              <Input
                id="notif-rate-limit"
                type="number"
                value={rateLimitPerWorkspace}
                onChange={(e) => setRateLimitPerWorkspace(e.target.value)}
              />{" "}
            </div>{" "}
            <div className="space-y-2">
              {" "}
              <Label htmlFor="notif-test-recipient">
                Test dispatch recipient
              </Label>{" "}
              <Input
                id="notif-test-recipient"
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
              />{" "}
            </div>{" "}
          </div>{" "}
          <div className="flex items-center justify-between border rounded-md p-4">
            {" "}
            <div className="space-y-1">
              {" "}
              <Label htmlFor="notif-tls-switch" className="text-sm font-medium">
                {" "}
                Require STARTTLS / strict certificate verification{" "}
              </Label>{" "}
              <p className="text-xs">
                {" "}
                Reject relay connections if TLS handshake or hostname
                verification fails.{" "}
              </p>{" "}
            </div>{" "}
            <Switch
              id="notif-tls-switch"
              aria-label="Require STARTTLS / strict certificate verification"
              checked={tlsEnforced}
              onCheckedChange={(checked) => setTlsEnforced(Boolean(checked))}
            />{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {" "}
            <span className="text-xs">
              {" "}
              Sender: {senderAddress} · Limit: {rateLimitPerWorkspace}/hr per
              workspace{" "}
            </span>{" "}
            <div className="flex items-center gap-2">
              {" "}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDispatchMessage(
                    `Queued test email from ${senderAddress} to ${testRecipient} via ${smtpHost} (250 OK).`,
                  )
                }
              >
                {" "}
                Test email dispatch{" "}
              </Button>{" "}
              <Button
                type="button"
                onClick={() =>
                  setDispatchMessage(
                    `Saved notification relay configuration (${smtpHost}, ${rateLimitPerWorkspace}/hr ceiling).`,
                  )
                }
              >
                {" "}
                Save notification settings{" "}
              </Button>{" "}
            </div>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type DeliveryItem = {
  id: string;
  channel: "Email" | "Webhook" | "Integration";
  destination: string;
  eventKey: string;
  status: "Pending" | "Delivered" | "Dead-letter";
  attempts: number;
};
export function GodModeDeliveriesScreen() {
  const [statusFilter, setStatusFilter] = useState<
    "All" | "Pending" | "Delivered" | "Dead-letter"
  >("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([
    {
      id: "dlv_901",
      channel: "Email",
      destination: "requester@acme.example.com",
      eventKey: "ticket.comment.created",
      status: "Delivered",
      attempts: 1,
    },
    {
      id: "dlv_902",
      channel: "Webhook",
      destination: "https://hooks.tenant-a.example.org/taskdesk",
      eventKey: "sla.breach.imminent",
      status: "Dead-letter",
      attempts: 5,
    },
    {
      id: "dlv_903",
      channel: "Integration",
      destination: "scim://directory-reconcile/org_northwind",
      eventKey: "scim.group.synced",
      status: "Pending",
      attempts: 2,
    },
    {
      id: "dlv_904",
      channel: "Webhook",
      destination: "https://ops.globex.example.org/events",
      eventKey: "approval.decision.recorded",
      status: "Dead-letter",
      attempts: 5,
    },
  ]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const visibleDeliveries = deliveries.filter((item) => {
    const matchesStatus =
      statusFilter === "All" || item.status === statusFilter;
    const matchesSearch =
      searchQuery.trim() === "" ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.destination.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.eventKey.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });
  const handleRetryDelivery = (id: string) => {
    setDeliveries((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, status: "Pending", attempts: d.attempts + 1 } : d,
      ),
    );
    setActionNotice(`Re-queued delivery ${id} for immediate worker dispatch.`);
  };
  const handleReplaySelected = () => {
    setDeliveries((prev) =>
      prev.map((d) =>
        d.status === "Dead-letter"
          ? { ...d, status: "Pending", attempts: d.attempts + 1 }
          : d,
      ),
    );
    setActionNotice(
      "Replayed all Dead-letter deliveries back into the active outbox queue.",
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Deliveries" />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <h1 className="text-2xl font-semibold">
            {" "}
            Instance outbox & dead-letter queue inspector{" "}
          </h1>{" "}
          <p className="text-sm">
            {" "}
            Inspect email, webhook, and integration deliveries across tenants
            and replay dead-letter items.{" "}
          </p>{" "}
        </div>{" "}
        <Button type="button" onClick={handleReplaySelected}>
          {" "}
          Replay selected{" "}
        </Button>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/deliveries" />{" "}
      {actionNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Outbox queue action</p>{" "}
            <p className="text-xs">{actionNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">Delivery queue filters</CardTitle>{" "}
          <CardDescription>
            {" "}
            Filter by delivery lifecycle state or search by destination and
            event key.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex flex-wrap items-end justify-between gap-4">
            {" "}
            <div className="flex flex-wrap items-center gap-2">
              {" "}
              {(["All", "Pending", "Delivered", "Dead-letter"] as const).map(
                (status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={statusFilter === status ? "default" : "outline"}
                    onClick={() => setStatusFilter(status)}
                  >
                    {" "}
                    {status}{" "}
                  </Button>
                ),
              )}{" "}
            </div>{" "}
            <div className="space-y-1">
              {" "}
              <Label htmlFor="deliveries-search-input">Search deliveries</Label>{" "}
              <Input
                id="deliveries-search-input"
                placeholder="Filter by ID, event, or endpoint..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />{" "}
            </div>{" "}
          </div>{" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Delivery ID</th> <th>Channel</th> <th>Event Key</th>{" "}
                  <th>Destination</th> <th>Attempts</th> <th>Status</th>{" "}
                  <th>Action</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {visibleDeliveries.map((item) => (
                  <tr key={item.id}>
                    {" "}
                    <td className="font-mono text-xs">{item.id}</td>{" "}
                    <td>{item.channel}</td>{" "}
                    <td className="font-mono text-xs">{item.eventKey}</td>{" "}
                    <td className="text-xs">{item.destination}</td>{" "}
                    <td>{item.attempts}</td>{" "}
                    <td>
                      {" "}
                      <Badge
                        variant={
                          item.status === "Delivered"
                            ? "success"
                            : item.status === "Dead-letter"
                              ? "error"
                              : "warning"
                        }
                      >
                        {" "}
                        {item.status}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetryDelivery(item.id)}
                      >
                        {" "}
                        Retry delivery{" "}
                      </Button>{" "}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type FeatureFlagItem = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};
export function GodModeFeaturesScreen() {
  const [flags, setFlags] = useState<FeatureFlagItem[]>([
    {
      key: "portal.enabled",
      label: "Customer Self-Service Portal",
      description:
        "Expose the authenticated requester portal for ticket submission and SLA tracking.",
      enabled: true,
    },
    {
      key: "scim.provisioning",
      label: "SCIM 2.0 Directory Provisioning",
      description:
        "Allow organisation-scoped SCIM user and group synchronisation.",
      enabled: true,
    },
    {
      key: "automations.engine",
      label: "Event-Driven Automations Engine",
      description:
        "Evaluate deterministic trigger-condition-action rules on ticket events.",
      enabled: true,
    },
    {
      key: "mcp.server",
      label: "Model Context Protocol (MCP) Server",
      description:
        "Enable governed MCP tool endpoints with mandatory PA-1 pending action approvals.",
      enabled: false,
    },
    {
      key: "sla.escalation",
      label: "Automated SLA Breach Escalation",
      description:
        "Run background SLA calendars and trigger escalation policies on target breach.",
      enabled: true,
    },
    {
      key: "approvals.quorum",
      label: "Multi-Approver Quorum Gates",
      description:
        "Require multi-reviewer quorum sign-off on gated workflow transitions.",
      enabled: true,
    },
  ]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const toggleFlag = (key: string, nextValue: boolean) => {
    setFlags((prev) =>
      prev.map((flag) =>
        flag.key === key ? { ...flag, enabled: nextValue } : flag,
      ),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Features" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Instance-wide feature flags{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Toggle runtime capabilities across the instance without rebuilding or
          redeploying containers.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/features" />{" "}
      {savedNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Feature flags persisted</p>{" "}
            <p className="text-xs">{savedNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Registered runtime feature flags
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Authoritative flags governed by
            docs/01-architecture/plugin-architecture.md.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="space-y-3">
            {" "}
            {flags.map((flag) => {
              const switchId = `feature-flag-${flag.key.replace(/\./g, "-")}`;
              return (
                <div
                  key={flag.key}
                  className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
                >
                  {" "}
                  <div className="space-y-1">
                    {" "}
                    <div className="flex items-center gap-2">
                      {" "}
                      <Label
                        htmlFor={switchId}
                        className="text-sm font-semibold"
                      >
                        {" "}
                        {flag.label}{" "}
                      </Label>{" "}
                      <Badge variant="outline" className="font-mono">
                        {" "}
                        {flag.key}{" "}
                      </Badge>{" "}
                      <Badge variant={flag.enabled ? "success" : "secondary"}>
                        {" "}
                        {flag.enabled ? "Enabled" : "Disabled"}{" "}
                      </Badge>{" "}
                    </div>{" "}
                    <p className="text-xs">{flag.description}</p>{" "}
                  </div>{" "}
                  <Switch
                    id={switchId}
                    aria-label={flag.key}
                    checked={flag.enabled}
                    onCheckedChange={(checked) =>
                      toggleFlag(flag.key, Boolean(checked))
                    }
                  />{" "}
                </div>
              );
            })}{" "}
          </div>{" "}
          <Separator />{" "}
          <div className="flex items-center justify-between gap-4">
            {" "}
            <span className="text-xs">
              {" "}
              {flags.filter((f) => f.enabled).length} of {flags.length} instance
              feature flags enabled.{" "}
            </span>{" "}
            <Button
              type="button"
              onClick={() =>
                setSavedNotice(
                  `Saved feature flag state (${flags
                    .filter((f) => f.enabled)
                    .map((f) => f.key)
                    .join(",")}).`,
                )
              }
            >
              {" "}
              Save feature flags{" "}
            </Button>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type BackgroundJobItem = {
  name: string;
  cadence: string;
  lastRun: string;
  status: "Healthy" | "Running";
};
export function GodModeJobsScreen() {
  const [jobs, setJobs] = useState<BackgroundJobItem[]>([
    {
      name: "sla-breach-evaluator",
      cadence: "Every 60 seconds",
      lastRun: "2026-10-20 08:13:00 UTC (42ms)",
      status: "Healthy",
    },
    {
      name: "outbox-dispatcher",
      cadence: "Every 15 seconds",
      lastRun: "2026-10-20 08:13:45 UTC (19ms)",
      status: "Healthy",
    },
    {
      name: "scim-reconciler",
      cadence: "Every 15 minutes",
      lastRun: "2026-10-20 08:00:00 UTC (310ms)",
      status: "Healthy",
    },
    {
      name: "pending-action-expiry",
      cadence: "Every 5 minutes",
      lastRun: "2026-10-20 08:10:00 UTC (12ms)",
      status: "Healthy",
    },
    {
      name: "audit-retention-sweeper",
      cadence: "Daily at 02:00 UTC",
      lastRun: "2026-10-20 02:00:00 UTC (1.4s)",
      status: "Healthy",
    },
  ]);
  const [jobTriggerNotice, setJobTriggerNotice] = useState<string | null>(null);
  const handleRunJobNow = (jobName: string) => {
    setJobs((prev) =>
      prev.map((job) =>
        job.name === jobName
          ? {
              ...job,
              status: "Running",
              lastRun: "Triggered manually just now",
            }
          : job,
      ),
    );
    setJobTriggerNotice(
      `Dispatched immediate manual execution for worker"${jobName}".`,
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Jobs" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Background jobs & scheduled workers monitor{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Monitor recurring background jobs, execution cadences, last run
          status, and trigger on-demand runs.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/jobs" />{" "}
      {jobTriggerNotice ? (
        <Card>
          <CardContent className="py-3 space-y-1">
            {" "}
            <p className="font-semibold text-sm">Job dispatched</p>{" "}
            <p className="text-xs">{jobTriggerNotice}</p>{" "}
          </CardContent>
        </Card>
      ) : null}{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Registered background workers
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Authoritative workers governed by
            docs/01-architecture/background-jobs.md.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Worker ID</th> <th>Schedule Cadence</th> <th>Last Run</th>{" "}
                  <th>Status</th> <th>Manual Control</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {jobs.map((job) => (
                  <tr key={job.name}>
                    {" "}
                    <td className="font-mono text-xs font-medium">
                      {" "}
                      {job.name}{" "}
                    </td>{" "}
                    <td>{job.cadence}</td>{" "}
                    <td className="font-mono text-xs">{job.lastRun}</td>{" "}
                    <td>
                      {" "}
                      <Badge
                        variant={job.status === "Healthy" ? "success" : "info"}
                      >
                        {" "}
                        {job.status}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td>
                      {" "}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRunJobNow(job.name)}
                      >
                        {" "}
                        Run job now{" "}
                      </Button>{" "}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
type PluginContractItem = {
  packageName: string;
  contractVersion: string;
  kind: string;
  healthStatus: "Healthy" | "Standby";
  enabled: boolean;
};
export function GodModePluginsScreen() {
  const [plugins, setPlugins] = useState<PluginContractItem[]>([
    {
      packageName: "@taskdesk/plugin-auth-oidc",
      contractVersion: "1.2.0",
      kind: "Identity / OIDC",
      healthStatus: "Healthy",
      enabled: true,
    },
    {
      packageName: "@taskdesk/plugin-auth-saml",
      contractVersion: "1.2.0",
      kind: "Identity / SAML 2.0",
      healthStatus: "Healthy",
      enabled: true,
    },
    {
      packageName: "@taskdesk/plugin-storage-s3",
      contractVersion: "1.1.4",
      kind: "Object Storage",
      healthStatus: "Standby",
      enabled: false,
    },
    {
      packageName: "@taskdesk/plugin-email-smtp",
      contractVersion: "1.3.1",
      kind: "Transactional Email",
      healthStatus: "Healthy",
      enabled: true,
    },
  ]);
  const togglePlugin = (packageName: string, nextEnabled: boolean) => {
    setPlugins((prev) =>
      prev.map((plugin) =>
        plugin.packageName === packageName
          ? {
              ...plugin,
              enabled: nextEnabled,
              healthStatus: nextEnabled ? "Healthy" : "Standby",
            }
          : plugin,
      ),
    );
  };
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · Plugins" />{" "}
      <div className="space-y-1">
        {" "}
        <h1 className="text-2xl font-semibold">
          {" "}
          Registered plugin contracts{" "}
        </h1>{" "}
        <p className="text-sm">
          {" "}
          Inspect and toggle @taskdesk/plugins-contracts implementations
          compiled into the runtime image.{" "}
        </p>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/plugins" />{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">Plugin registry</CardTitle>{" "}
          <CardDescription>
            {" "}
            Every customer runs the same immutable container image; plugins
            activate at runtime via database policy.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-3">
          {" "}
          {plugins.map((plugin) => {
            const switchId = `plugin-switch-${plugin.packageName.replace(/[^a-z0-9]/gi, "-")}`;
            return (
              <div
                key={plugin.packageName}
                className="flex flex-wrap items-center justify-between gap-4 border rounded-md p-4"
              >
                {" "}
                <div className="space-y-1">
                  {" "}
                  <div className="flex flex-wrap items-center gap-2">
                    {" "}
                    <Label
                      htmlFor={switchId}
                      className="font-mono text-sm font-semibold"
                    >
                      {" "}
                      {plugin.packageName}{" "}
                    </Label>{" "}
                    <Badge variant="outline">v{plugin.contractVersion}</Badge>{" "}
                    <Badge
                      variant={
                        plugin.healthStatus === "Healthy"
                          ? "success"
                          : "secondary"
                      }
                    >
                      {" "}
                      {plugin.healthStatus}{" "}
                    </Badge>{" "}
                  </div>{" "}
                  <p className="text-xs"> Contract kind: {plugin.kind} </p>{" "}
                </div>{" "}
                <div className="flex items-center gap-3">
                  {" "}
                  <span className="text-xs">
                    {" "}
                    {plugin.enabled ? "Enabled" : "Disabled"}{" "}
                  </span>{" "}
                  <Switch
                    id={switchId}
                    aria-label={`Toggle ${plugin.packageName}`}
                    checked={plugin.enabled}
                    onCheckedChange={(checked) =>
                      togglePlugin(plugin.packageName, Boolean(checked))
                    }
                  />{" "}
                </div>{" "}
              </div>
            );
          })}{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}
export function GodModeMcpScreen() {
  const [mcpServerEnabled, setMcpServerEnabled] = useState(true);
  const [readTicketsScope, setReadTicketsScope] = useState(true);
  const [draftReplyScope, setDraftReplyScope] = useState(true);
  const [transitionWorkflowScope, setTransitionWorkflowScope] = useState(false);
  const invocationLog = [
    {
      id: "mcp_call_401",
      tool: "tickets.search",
      principal: "agent:claire@example.org",
      policyGate: "ticket:read (Allowed)",
      timestamp: "2026-10-20 08:11:04 UTC",
    },
    {
      id: "mcp_call_402",
      tool: "tickets.bulkDelete",
      principal: "agent:claire@example.org",
      policyGate: "PA-1 Pending Approval Required",
      timestamp: "2026-10-20 08:12:19 UTC",
    },
    {
      id: "mcp_call_403",
      tool: "kb.lookupArticle",
      principal: "agent:marcus@example.org",
      policyGate: "kb:read (Allowed)",
      timestamp: "2026-10-20 08:13:51 UTC",
    },
  ];
  return (
    <main className="flex min-h-full w-full flex-col gap-6 p-6">
      {" "}
      <PageTitle title="God Mode · MCP Governance" />{" "}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {" "}
        <div className="space-y-1">
          {" "}
          <div className="flex items-center gap-2">
            {" "}
            <h1 className="text-2xl font-semibold">
              {" "}
              Model Context Protocol (MCP) usage & governance{" "}
            </h1>{" "}
            <Badge variant="info">PA-1</Badge>{" "}
          </div>{" "}
          <p className="text-sm">
            {" "}
            Govern MCP server availability, active tool scopes,
            destructive-action pending approvals, and invocation audit logs.{" "}
          </p>{" "}
        </div>{" "}
      </div>{" "}
      <GodModeSectionNav activePath="/agent/god-mode/mcp" />{" "}
      <Card>
        <CardContent className="py-3 space-y-1">
          {" "}
          <p className="font-semibold text-sm">
            Destructive-action pending-approval enforcement (PA-1)
          </p>{" "}
          <p className="text-xs">
            {" "}
            MCP callers inherit the caller&apos;s exact RBAC capabilities and
            never receive synthetic permissions. Any state-mutating or
            destructive tool call creates a PA-1 pending action requiring human
            confirmation.{" "}
          </p>{" "}
        </CardContent>
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            MCP server & tool scope controls
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Control whether MCP clients can connect and which read/write tool
            families are exposed.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent className="space-y-4">
          {" "}
          <div className="flex items-center justify-between border rounded-md p-4">
            {" "}
            <div className="space-y-1">
              {" "}
              <Label
                htmlFor="mcp-server-toggle"
                className="text-sm font-semibold"
              >
                {" "}
                Enable Model Context Protocol (MCP) server endpoint{" "}
              </Label>{" "}
              <p className="text-xs">
                {" "}
                Expose authenticated /api/mcp JSON-RPC transport to authorised
                agent tokens.{" "}
              </p>{" "}
            </div>{" "}
            <Switch
              id="mcp-server-toggle"
              aria-label="Enable Model Context Protocol (MCP) server endpoint"
              checked={mcpServerEnabled}
              onCheckedChange={(checked) =>
                setMcpServerEnabled(Boolean(checked))
              }
            />{" "}
          </div>{" "}
          <div className="grid gap-4 md:grid-cols-3">
            {" "}
            <div className="border rounded-md p-4 space-y-2">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <Label htmlFor="mcp-scope-read" className="text-sm font-medium">
                  {" "}
                  tickets.read & kb.read{" "}
                </Label>{" "}
                <Switch
                  id="mcp-scope-read"
                  aria-label="tickets.read & kb.read scope"
                  checked={readTicketsScope}
                  onCheckedChange={(checked) =>
                    setReadTicketsScope(Boolean(checked))
                  }
                />{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                Read-only query access scoped to caller workspace visibility.{" "}
              </p>{" "}
            </div>{" "}
            <div className="border rounded-md p-4 space-y-2">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <Label
                  htmlFor="mcp-scope-draft"
                  className="text-sm font-medium"
                >
                  {" "}
                  tickets.draftInternalNote{" "}
                </Label>{" "}
                <Switch
                  id="mcp-scope-draft"
                  aria-label="tickets.draftInternalNote scope"
                  checked={draftReplyScope}
                  onCheckedChange={(checked) =>
                    setDraftReplyScope(Boolean(checked))
                  }
                />{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                Allow AI assistants to stage internal agent notes without
                sending external replies.{" "}
              </p>{" "}
            </div>{" "}
            <div className="border rounded-md p-4 space-y-2">
              {" "}
              <div className="flex items-center justify-between gap-2">
                {" "}
                <Label
                  htmlFor="mcp-scope-transition"
                  className="text-sm font-medium"
                >
                  {" "}
                  tickets.transition (PA-1 gated){" "}
                </Label>{" "}
                <Switch
                  id="mcp-scope-transition"
                  aria-label="tickets.transition scope"
                  checked={transitionWorkflowScope}
                  onCheckedChange={(checked) =>
                    setTransitionWorkflowScope(Boolean(checked))
                  }
                />{" "}
              </div>{" "}
              <p className="text-xs">
                {" "}
                Propose workflow status transitions; always held for PA-1 human
                confirmation.{" "}
              </p>{" "}
            </div>{" "}
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
      <Card>
        {" "}
        <CardHeader>
          {" "}
          <CardTitle className="text-lg">
            Recent MCP tool invocation log
          </CardTitle>{" "}
          <CardDescription>
            {" "}
            Every MCP tool call is recorded with principal identity and policy
            evaluation outcome.{" "}
          </CardDescription>{" "}
        </CardHeader>{" "}
        <CardContent>
          {" "}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {" "}
              <thead>
                {" "}
                <tr>
                  {" "}
                  <th>Invocation ID</th> <th>Tool Name</th>{" "}
                  <th>Caller Principal</th> <th>Policy Gate</th>{" "}
                  <th>Timestamp</th>{" "}
                </tr>{" "}
              </thead>{" "}
              <tbody>
                {" "}
                {invocationLog.map((entry) => (
                  <tr key={entry.id}>
                    {" "}
                    <td className="font-mono text-xs">{entry.id}</td>{" "}
                    <td className="font-mono text-xs">{entry.tool}</td>{" "}
                    <td className="text-xs">{entry.principal}</td>{" "}
                    <td>
                      {" "}
                      <Badge
                        variant={
                          entry.policyGate.includes("PA-1")
                            ? "warning"
                            : "success"
                        }
                      >
                        {" "}
                        {entry.policyGate}{" "}
                      </Badge>{" "}
                    </td>{" "}
                    <td className="font-mono text-xs">
                      {entry.timestamp}
                    </td>{" "}
                  </tr>
                ))}{" "}
              </tbody>{" "}
            </table>
          </div>{" "}
        </CardContent>{" "}
      </Card>{" "}
    </main>
  );
}

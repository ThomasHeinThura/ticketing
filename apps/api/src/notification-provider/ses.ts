/**
 * Amazon SES is used through its SMTP interface: the endpoint is fixed by the region, the port
 * is 587 and the connection is upgraded with STARTTLS. This is the only place the endpoint is
 * derived; the API validates every write against it and the editor only displays the result.
 *
 * Regions are the ones that publish an SMTP endpoint in "Amazon Simple Email Service endpoints and
 * quotas" (AWS General Reference), checked 12 Nov 2026. Regions that have the SES API but no SMTP
 * endpoint (Cape Town, Hyderabad, Jakarta, Milan, Zurich, Tel Aviv, Bahrain, UAE, Calgary,
 * Malaysia) are deliberately absent.
 */
export const SES_SMTP_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ap-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
  "us-gov-east-1",
  "us-gov-west-1",
] as const;

export type SesSmtpRegion = (typeof SES_SMTP_REGIONS)[number];

export const SES_SMTP_PORT = 587;

export function sesSmtpHost(region: SesSmtpRegion): string {
  return `email-smtp.${region}.amazonaws.com`;
}

/** The fixed connection settings of an SES region: port 587, STARTTLS required, no implicit TLS. */
export function sesSmtpSettings(region: SesSmtpRegion) {
  return {
    host: sesSmtpHost(region),
    port: SES_SMTP_PORT,
    secure: false,
    requireTLS: true,
  } as const;
}

/** Every region with its derived host, in display order, for the editor's region picker. */
export function sesSmtpRegionOptions() {
  return SES_SMTP_REGIONS.map((region) => ({
    region,
    host: sesSmtpHost(region),
  }));
}

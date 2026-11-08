import { describe, expect, it } from "vitest";
import { isDisallowedAddress } from "../../../apps/api/src/utils/assert-public-destination";

describe("isDisallowedAddress", () => {
  it("blocks the ranges a webhook must never reach", () => {
    expect(isDisallowedAddress("localhost")).toBe(true);
    expect(isDisallowedAddress("127.0.0.1")).toBe(true);
    expect(isDisallowedAddress("10.0.0.1")).toBe(true);
    expect(isDisallowedAddress("172.16.0.1")).toBe(true);
    expect(isDisallowedAddress("192.168.1.1")).toBe(true);
    expect(isDisallowedAddress("169.254.169.254")).toBe(true);
    expect(isDisallowedAddress("[::1]")).toBe(true);
    expect(isDisallowedAddress("[::ffff:7f00:1]")).toBe(true);
  });

  // RFC 6598. Several hosted Kubernetes offerings put pod and service
  // networks in here, so on those clusters it reaches the same neighbours
  // 10/8 does on a plain VPC.
  it("blocks the shared address space", () => {
    expect(isDisallowedAddress("100.64.0.0")).toBe(true);
    expect(isDisallowedAddress("100.64.0.1")).toBe(true);
    expect(isDisallowedAddress("100.100.100.100")).toBe(true);
    expect(isDisallowedAddress("100.127.255.255")).toBe(true);
  });

  it("leaves the rest of 100.0.0.0/8 alone", () => {
    expect(isDisallowedAddress("100.63.255.255")).toBe(false);
    expect(isDisallowedAddress("100.128.0.0")).toBe(false);
    expect(isDisallowedAddress("100.0.0.1")).toBe(false);
  });

  it.each([
    "0:0:0:0:0:0:0:1",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "0:0:0:0:0:0:0:0",
    "0:0:0:0:0:ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:0:7f00:1",
    "::ffff:169.254.169.254",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "::127.0.0.1",
    "::7f00:1",
    "::10.0.0.1",
    "[0:0:0:0:0:0:0:1]",
    "FE80::1",
    "febf::1",
    "fec0::1",
    "FD00::1",
    "fc00::1",
    "ff02::1",
    "64:ff9b::7f00:1",
    "fe80::1%eth0",
    "64:ff9b:1::a00:1",
    "64:ff9b:1:0:0:0:7f00:1",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2001:0:4136:e378:8000:63bf:80ff:fffe",
    "100::1",
    "2001:db8::1",
    "3fff::1",
    "::8.8.8.8",
    "::2",
    "5f00::1",
  ])("blocks the IPv6 form %s", (address) => {
    expect(isDisallowedAddress(address)).toBe(true);
  });

  // Documentation ranges (TEST-NET) are not blocked: integration tests use them as stand-in
  // public destinations, and no real network routes them.
  it.each(["203.0.113.9", "198.51.100.7"])(
    "leaves the IPv4 documentation address %s to the resolver",
    (address) => {
      expect(isDisallowedAddress(address)).toBe(false);
    },
  );

  it("allows routable IPv6 and mapped routable IPv4", () => {
    expect(isDisallowedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isDisallowedAddress("[2001:4860:4860::8888]")).toBe(false);
    expect(isDisallowedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isDisallowedAddress("0:0:0:0:0:ffff:808:808")).toBe(false);
  });

  it("allows a routable address", () => {
    expect(isDisallowedAddress("8.8.8.8")).toBe(false);
    expect(isDisallowedAddress("93.184.216.34")).toBe(false);
    expect(isDisallowedAddress("example.com")).toBe(false);
  });
});

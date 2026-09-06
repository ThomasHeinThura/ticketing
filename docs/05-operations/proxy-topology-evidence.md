# Proxy topology — measured, not assumed

`TASKDESK_TRUST_PROXY` is a security boundary. It says how many reverse-proxy
hops in front of the application are trusted, and the client IP is read from
`X-Forwarded-For` at exactly that hop. Too low and every request looks like it
came from the proxy — one rate-limit bucket for the whole internet. Too high and
a header a client supplies becomes the client IP — rate-limit evasion, and an
API-key IP allowlist that any caller can satisfy.

So it is not set by counting the boxes in a diagram. This document records how
to measure it, and what the measurement returned for the hosts we run.

Written 2026-09-06, for issue #11.

---

## The method

Three questions, in order. Each has a way to answer it that does not involve
guessing.

**1 · Where does TLS terminate?**
Read the proxy's own access log for a real request and look at the entrypoint
and scheme it recorded. A proxy that recorded `http` on a port-80 entrypoint did
not terminate TLS; something in front of it did.

**2 · Does each hop append to `X-Forwarded-For`, or replace it?**
Send one request carrying a deliberately wrong `X-Forwarded-For`, and read what
each hop passed on. Appending hops each add one entry; a replacing hop
collapses the list to one. Only appending hops count.

**3 · What arrives at the application?**
The value that matters is the one the application process reads. Capture it
there — a request-header dump on a route that echoes them, or a log line —
rather than inferring it.

`TASKDESK_TRUST_PROXY` is then the number of hops that append, counted from the
application backwards. The client is that many entries from the right-hand end
of `X-Forwarded-For`.

---

## bimats.com — CloudFront → Traefik → TaskDesk

### What was measured

**DNS.** `ticket-uat.bimats.com`, `portal-uat.bimats.com` and every other name
under the wildcard resolve to `dm0sfn92kbtgv.cloudfront.net`.

**One request through the real chain.** A single `GET /` to
`https://ticket-uat.bimats.com`, carrying deliberately wrong forwarded headers:

```
X-Forwarded-For: 203.0.113.99
X-Forwarded-Proto: gopher
X-Forwarded-Host: evil.example
```

The host's Traefik recorded it as:

```json
{
  "entryPointName":  "web",
  "RequestScheme":   "http",
  "RequestProtocol": "HTTP/1.1",
  "ClientAddr":      "15.158.222.75:56754",
  "RouterName":      "taskdesk-uat@docker",
  "request_X-Forwarded-For": "203.0.113.99, 47.131.106.150"
}
```

Three facts follow directly:

- **TLS terminates at CloudFront, not at Traefik.** The request reached Traefik
  on the plain `web` (`:80`) entrypoint, over HTTP/1.1, scheme `http`.
- **CloudFront appends; it does not replace.** The forged `203.0.113.99`
  survived, with the real viewer address (`47.131.106.150`) appended after it.
- **Traefik trusts the CloudFront edge.** `15.158.222.75` falls in
  `15.158.0.0/16`, one of the CloudFront ranges in this Traefik's
  `entryPoints.web.forwardedHeaders.trustedIPs`.

**The Traefik hop, measured in isolation.** `traefik:v3.6.7` — the same version
the host runs — on a throwaway network, with the same `forwardedHeaders`
shape, in front of a backend that echoes the headers it receives:

| Peer | Sent to Traefik | Seen by the backend |
| --- | --- | --- |
| trusted | `XFF: 203.0.113.99, 47.131.106.150`<br>`XFP: gopher`<br>`XFH: evil.example` | `XFF: 203.0.113.99, 47.131.106.150, 172.80.2.4`<br>`XFP: gopher`<br>`XFH: evil.example` |
| trusted | `XFF: 47.131.106.150` only | `XFF: 47.131.106.150, 172.80.2.4`<br>`XFP: http`<br>`XFH: <the Host header>` |
| untrusted | all three, forged | all three **replaced** with Traefik's own values; `XFF` a single entry |

So Traefik, for a **trusted** peer, **preserves** the incoming `X-Forwarded-*`
and **appends** its own peer address to `X-Forwarded-For`. For an untrusted peer
it discards them, which is the behaviour that makes a forged header harmless
when nothing trusted is in front.

### The answer

```
viewer            sends nothing, or a forged X-Forwarded-For
  ↓
CloudFront        appends the viewer's address
  ↓
Traefik           trusts the edge, appends the edge address
  ↓
TaskDesk sees     X-Forwarded-For: <forged…>, <viewer>, <cloudfront-edge>
```

Two appending hops. The viewer is the **second entry from the right**.

```
TASKDESK_TRUST_PROXY=2
```

set in `deploy/compose.uat.yml` and nowhere else, because it is a property of
this host's topology and not of the product.

### Still open, and it matters

**One measurement is missing:** the header values as read by the TaskDesk
process itself. Capturing it needs v2 to be reachable through the chain, and v2
must not be publicly routed until #6 merges — the tree still carries the
inherited authentication defaults. The value above is derived from the two hops
measured separately rather than from one end-to-end capture.

To close it, once #6 has merged and the UAT overlay is applied:

1. `docker compose … exec taskdesk` and hit a route that echoes request headers,
   from outside, through `https://ticket-v2-uat.bimats.com`.
2. Confirm `X-Forwarded-For` has exactly three entries when one is forged and
   two when none is, and that the second from the right is the real client.
3. If it is not 2, change the overlay and amend this document. Do not change the
   application.

**`X-Forwarded-Proto` is not trustworthy on this topology, in either direction.**
The measurements show both failure modes:

- If CloudFront forwards a viewer-supplied `X-Forwarded-Proto`, Traefik passes
  it through verbatim to the application, because the CloudFront edge is a
  trusted peer. A viewer can therefore choose what protocol the application
  believes it is speaking.
- If CloudFront forwards none, Traefik sets `X-Forwarded-Proto: http`, because
  its own entrypoint is plain `:80`. The application then believes every HTTPS
  request was plain HTTP — wrong absolute URLs, wrong secure-cookie decisions,
  and the redirect loop the [Traefik guide](traefik-and-domains.md)'s failure
  table describes, for a different reason than the one listed there.

Which of the two applies depends on the CloudFront distribution's origin request
policy, which is not readable from the host. **Fix it at the CDN**: set an
origin custom header `X-Forwarded-Proto: https` on the distribution, which
CloudFront applies to every origin request and which overrides whatever the
viewer sent. Then the value reaching the application is constant and correct.
Until that is done, nothing on this topology should issue a secure cookie or
build an absolute URL from the forwarded protocol.

**Division of ownership.** Generic `getIp` correctness — reading
`X-Forwarded-For` at the configured hop, ignoring the rest, never falling back
to a caller-supplied value — is application code and belongs to #6. This
document owns only the topology and the number.

---

## The shipped topology — Traefik terminating TLS

`deploy/compose.prod.yml` and `deploy/compose.local.yml` set
`TASKDESK_TRUST_PROXY=1`, which is the documented default and correct for the
arrangement they describe: one Traefik, terminating TLS, directly in front, with
the application port unpublished so nothing else can reach the container.

That last clause is the load-bearing one. Compose *concatenates* `ports:` across
files, so the base `compose.yml` publishes nothing and only
`deploy/compose.local.yml` publishes 5173. `scripts/deploy.sh production`
asserts it: `docker compose port taskdesk 5173` must fail, and the deploy stops
if it succeeds. If the port were published, a client could reach the container
directly and set `X-Forwarded-For` to anything at all, and `1` would be a hole
rather than a setting.

---

## Related

- [Traefik and domains](traefik-and-domains.md) · [Deployment](deployment.md)
- [Configuration reference](configuration-reference.md) — the authority for
  `TASKDESK_TRUST_PROXY` itself

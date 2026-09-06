# Security Review D — Plugins, Webhooks, Outbound Requests, SSRF
TaskDesk v2 — post-merge review of PR #13 (kaneo snapshot import, merged before its mandatory review).
Reviewer: independent, adversarial. Repo: `/home/ubuntu/ticketing.v2` (branch `main`, merged state).
Runtime confirmed: **Node 24** (`Dockerfile.kaneo:84`), so `fetch` is undici — default `redirect: "follow"`, max 20 hops.

Legend for "resolved by #6": issue #6 deletes the six inherited plugin directories
(`github`, `gitea`, `slack`, `discord`, `telegram`, `generic-webhook`). Findings in those
directories are marked resolved-by-deletion. Everything marked **SURVIVES** is where the
real risk is, because it outlives #6.

---

## Executive verdict

The SSRF guard `apps/api/src/utils/assert-public-destination.ts` is **better than average** on
address-literal parsing — decimal/octal/hex IPv4, short-form IPv4, IPv4-mapped IPv6 in both
its dotted and its URL-normalised hex spelling, `0.0.0.0`, `169.254.169.254`, `[::1]`, `fd00::/8`
and `fe80::/10` are all genuinely blocked, and I verified each empirically rather than by
inspection. Its weaknesses are not in the parser, they are in **when** it runs and **who calls it**:

1. It resolves DNS once and throws the result away. Nothing pins the address. **DNS rebinding is unmitigated.**
2. The **surviving** outbound path (`notification-preferences/delivery.ts`) does not disable redirects,
   while the two **doomed** paths (`generic-webhook/client.ts`, `gitea/utils/gitea-api.ts`) do.
   #6 therefore deletes the hardened callers and keeps the unhardened one.
3. The guard's helper lives inside a directory #6 deletes (`plugins/generic-webhook/config.ts`)
   and is imported by two KEEP files. #6 as written breaks the build.
4. Its error strings are echoed verbatim to unauthenticated-tier callers, turning a user
   preference endpoint into an internal-DNS oracle.

---

## 1. SSRF — attacking `apps/api/src/utils/assert-public-destination.ts`

The entire guard is 114 lines. Control flow of the only async entry point:

```
apps/api/src/utils/assert-public-destination.ts:88-114
  const url = new URL(destinationUrl);                                      // 92
  if (!["http:","https:"].includes(url.protocol)) throw;                    // 94
  if (privateDestinationsAllowed()) return;                                 // 98  <- global kill switch
  if (isDisallowedAddress(url.hostname)) throw;                             // 102 literal check
  const addresses = await lookup(url.hostname, {all:true, verbatim:true});  // 106
  if (addresses.length === 0) throw;                                        // 107
  if (addresses.some(e => isDisallowedAddress(e.address))) throw;           // 111
  // ...and then returns. The resolved addresses are discarded.             // 114
```

### 1a. What the guard DOES stop — verified, not assumed

I ran every candidate through the same WHATWG `new URL()` + `net.isIP()` path the guard uses,
to see the *exact* string `isDisallowedAddress` receives:

| Attack input | `url.hostname` the guard actually sees | Blocked? | Deciding line |
|---|---|---|---|
| `http://127.0.0.1/` | `127.0.0.1` | YES | `:15` `a === 127` |
| `http://2130706433/` (decimal) | `127.0.0.1` (URL parser normalises) | YES | `:15` |
| `http://0x7f000001/` (hex) | `127.0.0.1` | YES | `:15` |
| `http://0177.0.0.1/` (octal) | `127.0.0.1` | YES | `:15` |
| `http://127.1/` (short form) | `127.0.0.1` | YES | `:15` |
| `http://127.0.0.1./` (trailing dot) | `127.0.0.1` | YES | `:15` |
| `http://0/` | `0.0.0.0` | YES | `:13` `a === 0` |
| `http://localhost/` / `http://LOCALHOST/` | `localhost` | YES | `:65` |
| `http://localhost./` | `localhost.` | YES — but only at step 2 (DNS), `:111` | `:111` |
| `http://169.254.169.254/` (AWS/Azure/GCP IMDS) | `169.254.169.254` | YES | `:20` |
| `http://10.x`, `http://172.16-31.x`, `http://192.168.x` | as written | YES | `:14,:21,:22` |
| `http://100.64-127.x` (RFC 6598, k8s pod nets) | as written | YES | `:19` |
| `http://[::1]/`, `http://[0:0:0:0:0:0:0:1]/` | `[::1]` | YES | `:50` |
| `http://[::ffff:127.0.0.1]/` | `[::ffff:7f00:1]` after normalisation | YES | `mappedIpv4` hex branch `:32-37` |
| `http://[::ffff:a9fe:a9fe]/` (mapped IMDS) | `[::ffff:a9fe:a9fe]` | YES | `:32-37` → `:20` |
| `http://[fd00:ec2::254]/` (EC2 IPv6 IMDS) | as written | YES | `:56` `startsWith("fd")` |
| `http://[fe80::1]/` | as written | YES | `:51` |
| `http://user:pw@169.254.169.254/` (userinfo) | `169.254.169.254` — userinfo stripped from `.hostname` | YES | `:20` |
| `http://169.254.169.254@example.com/` (userinfo decoy) | `example.com` | correctly ALLOWED — not a bypass |
| `file://`, `gopher://`, `ftp://`, `dict://` | n/a | YES | `:94` |
| A DNS name whose A/AAAA record is private | n/a | YES at step 2 | `:111` |

The IPv4-mapped-IPv6 unwrapping at `:26-38` handles both the dotted spelling and the hex spelling
the URL parser actually emits. That is the part most implementations get wrong; this one is right,
and the comment at `:26-27` shows it was tested. Credit where due.

### 1b. What the guard does NOT stop

---

### FINDING D-01 — DNS rebinding: the guard resolves once and never pins the address
**Severity: HIGH** · **SURVIVES #6**
**File:** `apps/api/src/utils/assert-public-destination.ts:106-114`

```ts
const addresses = await lookup(url.hostname, { all: true, verbatim: true });   // :106
...
if (addresses.some((entry) => isDisallowedAddress(entry.address))) { throw ... } // :111
}                                                                                // :114 — addresses discarded
```

`assertPublicDestination` returns `Promise<void>`. It never returns the vetted IP, and no caller
pins one. Every caller then hands the **hostname** back to `fetch()`, which performs its own,
independent `dns.lookup` at connect time:

- `apps/api/src/notification-preferences/delivery.ts:28` — `fetch(url, {...rest, signal})`
- `apps/api/src/plugins/generic-webhook/client.ts:41` — `fetch(webhookUrl, {...})`
- `apps/api/src/plugins/gitea/utils/gitea-api.ts:105` — `fetch(url, {...})`

**Attack path:** attacker sets their notification webhook to `http://rebind.attacker.tld/hook`.
`rebind.attacker.tld` is served by an attacker nameserver with `TTL 0`, alternating answers:
first query returns `203.0.113.10` (public, passes `:111`); the connect-time query returns
`169.254.169.254`. `PUT /notification-preferences` succeeds. Every subsequent notification
delivery POSTs the full notification payload to the cloud metadata service, and the response
body is surfaced in the thrown error (see D-06), which is logged.

**Fix:** make the guard return the vetted address set, and have callers connect to a **pinned IP**
with the original `Host` header (undici `Agent` with a custom `connect`/`lookup` that only returns
the vetted address), or re-validate inside a custom `lookup` hook so the check happens at connect
time, atomically. A `lookup` callback on the undici dispatcher that calls `isDisallowedAddress` on
each candidate is the smallest correct change.

**Owning issue:** NEW ISSUE (SSRF hardening of the surviving guard). Not resolved by #6.

---

### FINDING D-02 — Redirects are followed on the one outbound path that survives #6
**Severity: HIGH** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/delivery.ts:19-31`

```ts
async function fetchWithTimeout(url, init) {                     // :19
  ...
  return await fetch(url, { ...rest, signal: controller.signal }); // :28  <- no `redirect` option
}
```

No `redirect: "manual"`. Under Node 24/undici the default is `follow` (20 hops). All three
notification delivery senders use it *after* passing the guard:

- `sendNtfyNotification` — guard at `:286`, fetch at `:288`
- `sendGotifyNotification` — guard at `:315`, fetch at `:318`
- `sendWebhookNotification` — guard at `:359`, fetch at `:372`

Contrast with the two files #6 **deletes**, which got this right:

- `apps/api/src/plugins/generic-webhook/client.ts:46` — `redirect: "manual"`, plus an explicit
  redirect-status rejection at `:49-54` using `REDIRECT_STATUSES` (`:7`).
- `apps/api/src/plugins/gitea/utils/gitea-api.ts:110-112` — `redirect: "manual"` with the comment
  *"Following redirects would let a public host bounce the request to an internal address after
  the destination check has already passed."* and a 3xx rejection at `:117-123`.

So the author knew the failure mode, fixed it in the plugin clients, and missed the KEEP file.
**#6 will delete the two hardened callers and leave the unhardened one in production.**

**Attack path:** attacker sets webhook to `https://evil.tld/h`; that host answers
`302 Location: http://169.254.169.254/latest/meta-data/iam/security-credentials/`. The guard passed
(evil.tld is public), undici follows, and the metadata response body is embedded in the thrown
error at `delivery.ts:378-380` and logged at `:573-577`. Same trick reaches
`http://127.0.0.1:1337/…` internal API routes and any in-VPC service.

**Fix:** add `redirect: "manual"` to `fetchWithTimeout` at `:28` and reject 3xx, mirroring
`generic-webhook/client.ts:49-54`. Better: re-run `assertPublicDestination` on each `Location`
and cap the hop count.

**Owning issue:** NEW ISSUE. Explicitly **not** resolved by #6 — #6 makes it worse.

---

### FINDING D-03 — `assertPublicWebhookDestination` is defined inside a directory #6 deletes, and two KEEP files import it
**Severity: HIGH (correctness / security regression on merge of #6)** · **SURVIVES #6 as a break**
**Files:**
- `apps/api/src/plugins/generic-webhook/config.ts:4-8` (definition — **#6 DELETES this directory**)
- `apps/api/src/notification-preferences/delivery.ts:14` (**KEEP**) — `import { assertPublicWebhookDestination } from "../plugins/generic-webhook/config";`
- `apps/api/src/notification-preferences/service.ts:11` (**KEEP**) — same import

```ts
// apps/api/src/plugins/generic-webhook/config.ts:4-8
export async function assertPublicWebhookDestination(webhookUrl: string): Promise<void> {
  await assertPublicDestination(webhookUrl, "Generic webhook");
}
```

It is a one-line wrapper whose only value-add is the label string `"Generic webhook"` — which is
also why every SSRF rejection a *notification preferences* user sees says "Generic webhook",
a separate UX/telemetry wart.

Deleting `plugins/generic-webhook/` per #6 breaks the build of the surviving notification stack.
The likely hurried fix under time pressure is to strip the call rather than re-home it, which
silently removes SSRF validation from the only remaining outbound webhook path.

**Fix (do this *before* #6 lands):** move the wrapper into `apps/api/src/utils/`, or have the two
KEEP files call `assertPublicDestination(url, "Webhook")` directly. Add a test that fails if
`notification-preferences/` imports anything from `plugins/`.

**Owning issue:** #6 (pre-work) — must be sequenced ahead of the deletion.

---

### FINDING D-04 — Address-space gaps in the deny list
**Severity: MEDIUM** · **SURVIVES #6**
**File:** `apps/api/src/utils/assert-public-destination.ts:12-23`, `:48-57`

Verified as **NOT blocked** (each was run through `new URL()` + `net.isIP()` and traced through
the predicate):

| Not blocked | Normalised hostname | Why it matters |
|---|---|---|
| `http://[::7f00:1]/` (i.e. `::127.0.0.1`, IPv4-compatible IPv6) | `[::7f00:1]` | `mappedIpv4` (`:28-38`) only matches the `::ffff:` prefix; `:49-56` matches neither `::` nor `::1` nor `fe8/9/a/b`/`fc`/`fd`. Deprecated form, generally unrouted on Linux — **defence in depth, low exploitability** |
| `http://[64:ff9b::7f00:1]/` (NAT64 well-known prefix, RFC 6052) | as written | reaches 127.0.0.1 on any host behind a NAT64 gateway — real in IPv6-only clusters |
| `http://[2002:7f00:1::]/` (6to4, RFC 3056) | as written | reaches 127.0.0.1 where a 6to4 relay exists |
| `http://[fec0::1]/` (deprecated site-local) | as written | `:51-54` covers `fe8/fe9/fea/feb` only; `fec/fed/fee/fef` fall through |
| `http://[ff02::1]/`, `ff05::/16` (IPv6 multicast) | as written | link/site-local multicast |
| `http://224.0.0.1/` .. `239.x` (IPv4 multicast, 224/4) | as written | `:12-23` has no `a >= 224` clause |
| `http://255.255.255.255/` (limited broadcast) | as written | no `a === 255` clause |
| `http://192.0.0.171/` (192.0.0.0/24 IETF assignments, incl. NAT64 `192.0.0.170/171`) | as written | |
| `http://198.18.0.1/` (198.18.0.0/15 benchmarking) | as written | routed inside some corp networks |
| `http://192.88.99.1/` (6to4 anycast relay) | as written | |

Also note `isDisallowedIpv4` at `:5-8` fails **closed** on a malformed dotted quad (`return true`),
which is the right default and worth preserving in any rewrite.

**Fix:** replace the hand-rolled predicate with a CIDR table covering RFC 6890 special-purpose
registries for both families (`0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24,
192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4,
255.255.255.255/32` and `::/128, ::1/128, ::ffff:0:0/96, 64:ff9b::/96, 100::/64, 2001:db8::/32,
2002::/16, fc00::/7, fe80::/10, fec0::/10, ff00::/8`), driving it from a single table so it is
testable. Extend `tests/api/utils/assert-public-destination.test.ts` (currently only 4 cases of
blocked ranges, `:5-16`) with the whole table above.

**Owning issue:** NEW ISSUE. Not resolved by #6.

---

### FINDING D-05 — Guard error strings are returned verbatim to the client: internal-DNS oracle
**Severity: MEDIUM** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/service.ts:330-338, 348-356, 365-373`

```ts
try {
  new URL(webhookUrl);
  await assertPublicWebhookDestination(webhookUrl);          // :368
} catch (error) {
  throw new HTTPException(400, {
    message: error instanceof Error ? error.message : "Invalid webhook URL",   // :371
  });
}
```

The guard throws two **distinguishable** messages (`assert-public-destination.ts:108` vs `:103/:112`):

- `"Generic webhook destination could not be resolved"` → the name has **no** DNS record
- `"Generic webhook destination resolves to a non-routable address"` → the name **exists** and points into RFC1918/link-local

Any authenticated user — no workspace permission needed, this is a per-user preference route
(`apps/api/src/notification-preferences/index.ts:34-52`, `PUT /`) — can therefore enumerate the
operator's internal DNS namespace one name per request: `http://jenkins.internal/`,
`http://vault.corp/`, `http://db-primary.svc.cluster.local/`, and read off which resolve internally.

**Fix:** return a single generic 400 (`"Webhook URL is not an allowed destination"`) and log the
detail server-side only. Rate-limit the preference update route.

**Owning issue:** NEW ISSUE (or #8 if that is the notifications hardening issue). Not resolved by #6.

---

### FINDING D-06 — Remote/internal response bodies are embedded in errors and then logged
**Severity: MEDIUM** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/delivery.ts:301-305, 344-348, 376-380, 570-577`

```ts
throw new Error(`Webhook delivery failed (${response.status}): ${await response.text()}`);  // :378-380
...
console.error("Notification delivery failed", { notificationId, error: result.reason });    // :573-576
```

This converts every SSRF primitive above from **blind** to **read**: the attacker does not even
need the response returned to them over HTTP, they only need an operator/log-shipping path
(Sentry, stdout → Loki/CloudWatch) that they can read, or a support ticket that quotes the log.
Combined with D-01 or D-02, the IMDS credential document lands in the log pipeline in plaintext.

Same pattern in the doomed plugins: `slack/client.ts:49-52`, `discord/client.ts:61-64`,
`telegram/client.ts:39-42`, `generic-webhook/client.ts:57-60`.

**Fix:** never interpolate a response body into an error. Log status + a truncated, redacted
excerpt behind a debug flag at most.

**Owning issue:** NEW ISSUE. Plugin copies resolved by #6; the `delivery.ts` copy is not.

---

### FINDING D-07 — `sendNtfyNotification` / `sendGotifyNotification` validate one URL and fetch a different one
**Severity: LOW** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/delivery.ts:286-291` and `:315-321`

```ts
await assertPublicWebhookDestination(input.serverUrl);                      // :286
const response = await fetchWithTimeout(
  `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,  // :288-289
```

The string that is validated and the string that is fetched are not the same value. I traced the
concatenation and could **not** construct an authority change from it — appending after the
authority can only land in path/query/fragment — so I am *not* claiming a bypass here. It is
nonetheless a validate-one-thing/use-another pattern that will break the moment someone makes
`serverUrl` more permissive.

**Fix:** build the final URL first (`new URL(path, serverUrl)`), validate **that**, then fetch it.

**Owning issue:** NEW ISSUE (hygiene). Not resolved by #6.

---

## 2. Is the guard called on every outbound path?  No — enumeration

Every non-test `fetch(` in `apps/api/src`:

| # | Call site | Destination controlled by | Guarded? | Redirects |
|---|---|---|---|---|
| 1 | `notification-preferences/delivery.ts:28` (used by `:288`, `:318`, `:372`) | **any authenticated user** (own preference) | YES (`:286`, `:315`, `:359`) | **FOLLOWED — D-02** |
| 2 | `plugins/generic-webhook/client.ts:41` | workspace `manage_settings` | YES (`:16`) | manual (`:46`) |
| 3 | `plugins/gitea/utils/gitea-api.ts:105` | workspace `manage_settings` | YES (`:81`) | manual (`:110`) |
| 4 | `plugins/slack/client.ts:39` | workspace `manage_settings` | **NO** | **FOLLOWED** |
| 5 | `plugins/discord/client.ts:51` | workspace `manage_settings` | **NO** | **FOLLOWED** |
| 6 | `plugins/telegram/client.ts:26` | host is the literal `https://api.telegram.org` | n/a (fixed host) | followed, harmless |
| 7 | `utils/verify-turnstile.ts:38` | constant `TURNSTILE_VERIFY_URL` | n/a | harmless |
| 8 | `mcp/tools.ts:56` | `baseUrl` from server config, not user input | n/a | self-call |

### FINDING D-08 — Slack and Discord webhook posts have **no** destination validation at all
**Severity: HIGH** · **RESOLVED BY #6 DELETION**
**Files:** `apps/api/src/plugins/slack/client.ts:26-46`, `apps/api/src/plugins/discord/client.ts:38-58`

```ts
export async function postToSlack(webhookUrl: string, message: SlackMessage) {   // slack:26
  ...
  const response = await fetch(webhookUrl, { method: "POST", ... });             // slack:39
```

No `assertPublicWebhookDestination`, no `redirect: "manual"`, no host allowlist (a real Slack
webhook is always `https://hooks.slack.com/services/...`; Discord always
`https://discord.com/api/webhooks/...`). A user with `workspace:manage_settings` sets the Slack
webhook URL to `http://169.254.169.254/latest/meta-data/…` and every task event POSTs there,
with the response body surfaced in the error at `slack/client.ts:49-52` (see D-06).
This is a **strictly worse** SSRF than the generic-webhook plugin, which is the one that got hardened.

**Fix (if any of this were kept):** allowlist the vendor host; otherwise call the guard.
**Owning issue:** #6 removals. **Deletion resolves it.** Until #6 lands this is live in `main`.

---

### FINDING D-09 — Telegram bot token is interpolated into a URL path unescaped
**Severity: LOW** · **RESOLVED BY #6 DELETION**
**File:** `apps/api/src/plugins/telegram/client.ts:26-27`

```ts
const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
```

`botToken` is unescaped operator/tenant input. It cannot change the authority (it lands after the
host), but it can inject `?`/`#`/path segments, and it puts a live credential into a URL that
appears in error text, proxies and access logs. Same class as the acknowledged Gotify problem —
see the honest comment at `delivery.ts:313-314`:
`"Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history"`.
That Gotify instance of the problem **survives** #6 (`delivery.ts:317-319`).

**Owning issue:** #6 removals for telegram; **NEW ISSUE** for the surviving Gotify query-string token.

---

## 3. `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS`

### FINDING D-10 — The escape hatch is a global, all-or-nothing kill switch, and the docs describe it as something else
**Severity: MEDIUM** · **SURVIVES #6**
**File:** `apps/api/src/utils/assert-public-destination.ts:81-100`

```ts
function privateDestinationsAllowed(): boolean {                       // :81
  return (
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "true" || // :83
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "1"       // :84
  );
}
...
if (privateDestinationsAllowed()) { return; }                          // :98-100
```

**What it disables — precisely:** the early `return` at `:98` sits *after* the scheme check (`:94`)
and *before* everything else. So with the flag on:
- scheme is still restricted to `http:`/`https:` — this remains enforced;
- the literal-address check (`:102`) is skipped entirely;
- **the DNS resolution at `:106` does not even run** — so the "resolves to a private IP" check is
  skipped, and so is the "could not be resolved" check.

**Scope: process-global only.** It is read from `process.env`, with no tenant, workspace, project
or per-integration parameter anywhere in the signature (`assertPublicDestination(destinationUrl, label)`,
`:88-91`). There is **no** per-tenant form. One operator flipping it removes SSRF protection for
*every* tenant on the instance, on *all four* guarded call sites simultaneously.

**Docs/implementation mismatch — this is the dangerous part.**
`docs/04-engineering/repository-bootstrap.md:230` describes it as:

> `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` | Move | **the egress allowlist, default empty**

It is **not an allowlist** and has no concept of "empty" — it is a boolean. An operator who reads
that line and sets it to a hostname (`internal.example.com`) gets a silent no-op (fails safe, by
luck, since the value matches neither `"true"` nor `"1"`). An operator who reads "allowlist" and
sets `true` expecting scoped relaxation globally disables SSRF protection.

**Second, unresolved contradiction:** the plan of record deletes this variable along with the
generic-webhook router — `docs/01-architecture/inherited-features.md:146` ("it goes with the router"),
`docs/07-planning/decision-log.md:394`, and the pre-P0 review
`docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/README.md:33` ("delete … their tables and
env vars (`NOTIFICATION_SECRET_ENCRYPTION_KEY`, `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS`)").
But the variable is read from a **KEEP** file and gates the **KEEP** notification-delivery path.
`docs/07-planning/status.md:400` already lists "`KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS`
self-contradictions" as an open item; this review confirms the contradiction is real and
security-relevant, not cosmetic.

**Fix:** (a) rename to `TASKDESK_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` and keep it, since the
notification webhook path needs a self-hosted/dev escape; (b) make it a genuine **CIDR/host
allowlist** (`TASKDESK_WEBHOOK_ALLOWED_DESTINATIONS=10.0.0.0/8,ntfy.internal`) rather than a
boolean bypass, and validate resolved addresses against it instead of skipping validation;
(c) log loudly at boot when it is non-empty; (d) fix `repository-bootstrap.md:230` and the
delete-it decision in `inherited-features.md:146` / `decision-log.md:394`.

**Owning issue:** #6 (resolve the delete-vs-keep contradiction) **plus** a NEW ISSUE for the
allowlist rewrite. **#6 does not resolve it** — #6 as written would delete a variable the surviving
code still reads.

---

## 4. Inbound webhook signature verification

### 4a. Gitea — correct, with one dead branch and no replay defence

**File:** `apps/api/src/plugins/gitea/utils/verify-signature.ts:1-29`

```ts
const expected = createHmac("sha256", secret).update(payload).digest("hex");  // :17
try {
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;                                    // :22-24
  return timingSafeEqual(a, b);                                               // :25
} catch {
  return provided === expected;                                               // :27  <- non-constant-time
}
```

- **Constant-time: YES** (`:25`), with the mandatory length pre-check at `:22`.
- The `catch` fallback at `:27` is a non-constant-time `===`. In practice it is **unreachable**:
  `Buffer.from(x, "hex")` does not throw on malformed hex (it truncates), and `timingSafeEqual`
  only throws on length mismatch, which `:22` already excludes. Still, delete it — it is a
  timing-leak landmine one refactor away from being live. **Severity LOW.**
- **Raw body: YES.** `apps/api/src/gitea-integration/index.ts:333-334` reads
  `await c.req.arrayBuffer()` and converts to a UTF-8 string; that exact string is passed through
  `handleGiteaWebhookRequest(integrationId, body, ...)` and used for both HMAC (`webhook-handler.ts:100`)
  and `JSON.parse` (`webhook-handler.ts:112`). No re-serialisation. Correct.
- **Skippable when no secret? NO — fails closed.**
  `webhook-handler.ts:97-99`: `const secret = config.webhookSecret; if (!secret) return { success:false, error:"Webhook secret not configured" };`
  and `verify-signature.ts:8-10` returns `false` on a missing header or empty secret. Good.

### FINDING D-11 — No replay window or delivery-ID dedup on any inbound webhook
**Severity: MEDIUM** · **RESOLVED BY #6 DELETION**
**Files:** `apps/api/src/plugins/gitea/webhook-handler.ts:74-127`, `apps/api/src/plugins/github/webhook-handler.ts:13-53`

Neither handler carries a timestamp check, nonce, or `x-github-delivery` / delivery-ID dedup store.
`deliveryId` is read at `github-integration/index.ts:348` and passed to Octokit at
`github/webhook-handler.ts:35` purely as a **log label** — it is never persisted or checked.
A captured signed body stays valid forever and can be replayed unlimited times, re-driving
`dispatchGiteaEvent` / the Octokit handlers (re-open issues, re-apply status transitions,
re-create tasks). Signature validity is not the same as freshness.

**Fix:** persist `(integrationId, deliveryId)` with a TTL and reject repeats; require a signed
timestamp header with a ±5 min window where the sender supports one.
**Owning issue:** #6 removals. Deletion resolves it. Re-introduce the control in any future
inbound-webhook feature.

### 4b. GitHub — delegated to Octokit, but the trust boundary is global

`apps/api/src/plugins/github/webhook-handler.ts:32-41` calls
`githubApp.webhooks.verifyAndReceive({ id, name, signature, payload: body })` with the raw body
string from `github-integration/index.ts:336-337`. `@octokit/webhooks` uses a constant-time compare
and the raw payload, so signature verification itself is fine. `getGithubApp()`
(`github/utils/github-app.ts:31-54`) returns `null` unless `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`
and a private key are all set, and `webhook-handler.ts:25-28` fails closed when it is `null`.
Verification cannot be skipped. The **secret is a single instance-wide value**, which is what
makes D-12 possible.

---

## 5. Outbound signing (`X-TaskDesk-Signature`)

Two identical implementations:

```ts
// apps/api/src/notification-preferences/delivery.ts:366-370   (SURVIVES)
if (input.secret) {
  headers["X-TaskDesk-Signature"] = createHmac("sha256", input.secret).update(body).digest("hex");
}
// apps/api/src/plugins/generic-webhook/client.ts:23-27        (#6 deletes)
```

### FINDING D-12 — Outbound signature is unversioned and has no timestamp, so receivers cannot detect replay
**Severity: LOW** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/delivery.ts:366-370`

The header is a bare hex HMAC of the body: no `v1=` scheme prefix, no `t=<unix>` component, no
signed timestamp. A receiver has no way to reject a replayed delivery, and the scheme cannot be
rotated to a new algorithm without breaking every receiver. Also note `if (input.secret)` at `:366`
means an empty/absent secret silently sends the payload **unsigned** rather than refusing —
acceptable (signing is opt-in) but it should be surfaced in the UI.

**Fix:** emit `X-TaskDesk-Signature: v1=<hex>` over `"<timestamp>.<body>"` and add
`X-TaskDesk-Timestamp`, Stripe/Slack style. Document the verification recipe.
**Owning issue:** NEW ISSUE. Not resolved by #6.

**Secret storage for this path — good news.** The signing secret comes from
`decryptSecret(preference.webhookSecret)` (`delivery.ts:435`), i.e. it is AES-256-GCM encrypted at
rest (see §6) and is **never** returned by an API in full: `notification-preferences/service.ts:212-213`
returns only `webhookSecretConfigured: boolean` and `maskedWebhookSecret`. It is never written to a
log — I grepped the delivery and service paths; the only `console.error` (`delivery.ts:573-576`)
logs `notificationId` and `result.reason`, and the secret does not appear in `result.reason` for
any of the throw sites. **No leak found on this path.**

---

## 6. Secret handling

### 6a. Notification-preference secrets — done properly
`apps/api/src/notification-preferences/secrets.ts`
- AES-256-GCM with a random 12-byte IV per value, auth tag stored alongside; format
  `enc:v1:<iv>.<tag>.<ct>` (`:9-11`, `:66-78`). Authenticated encryption, versioned prefix,
  idempotent re-encrypt (`:62-64`). This is the right shape.
- Returned to clients only as `*Configured: boolean` + `masked*` (`service.ts:195-213`).
- Key is required — `requireSecretEncryptionKey()` throws 500 rather than falling back to
  plaintext (`:22-32`). Fails closed. Good.

### FINDING D-13 — Encryption key is an unsalted single SHA-256 of an env string, and plaintext legacy values are silently accepted
**Severity: MEDIUM** · **SURVIVES #6**
**File:** `apps/api/src/notification-preferences/secrets.ts:13-20`, `:81-86`

```ts
return createHash("sha256").update(rawKey).digest();      // :19  — no KDF, no salt, single round
...
export function decryptSecret(value) {
  if (value === undefined || value === null || !isEncryptedSecret(value)) {
    return value;                                          // :84-86 — plaintext passes straight through
  }
```

1. `TASKDESK_ENCRYPTION_KEY` is stretched with **one** unsalted SHA-256. If an operator sets a
   human-chosen passphrase (very likely — nothing forces entropy, no length check), a DB dump is
   brute-forcible offline at hashcat speeds. Use scrypt/PBKDF2 with a stored salt, or require a
   32-byte base64 key and reject anything shorter.
2. `decryptSecret` returns any value lacking the `enc:v1:` prefix **unchanged** (`:84-86`). This is
   the intended migration shim, but it means a row that is plaintext for any reason (a failed
   migration, a direct DB write, a rollback across the encryption commit) is used happily and
   silently, with no metric or warning. Add a migration that encrypts every legacy row and then
   make an unprefixed value an error.
3. Note the env-var name drift: code reads `TASKDESK_ENCRYPTION_KEY` (`:14`) while the planning
   docs repeatedly name `NOTIFICATION_SECRET_ENCRYPTION_KEY`
   (`docs/04-engineering/repository-bootstrap.md:330`, `decision-log.md:394`,
   `pre-p0-check-fable/README.md:33`). Whichever is authoritative, an operator following the docs
   will leave the key unset — which turns every secret write into an HTTP 500 (`secrets.ts:25-29`).

**Owning issue:** NEW ISSUE. Not resolved by #6.

### FINDING D-14 — Plugin secrets are stored in the `integration.config` column as **plaintext JSON**
**Severity: HIGH** · **RESOLVED BY #6 DELETION** (of the plugins *and* the table)
**File:** `apps/api/src/database/schema.ts:867-892`

```ts
export const integrationTable = pgTable("integration", {
  ...
  type: text("type").notNull(),
  config: text("config").notNull(),        // :880 — plain text, no encryption
```

Everything the six plugins hold lives in that column, unencrypted and unhashed:
- Gitea personal access token and webhook secret (`gitea-integration/controllers/get-gitea-integration.ts:32,44,46`)
- Generic-webhook HMAC signing secret (`generic-webhook-integration/index.ts:46-47`)
- Slack / Discord webhook URLs — which **are** bearer credentials
- Telegram bot token

The same repo encrypts *user* notification secrets (§6a) but not *workspace* integration secrets.
A read-only DB compromise, a logical backup, or a replica hands the attacker every tenant's
integration credentials in cleartext. Note the pre-P0 review at
`docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/L1-bootstrap.md:21` calls this column
"encrypted `config`" — **it is not**; that description is wrong and should be corrected before
anyone relies on it.

**Owning issue:** #6 removals (the table goes with the plugins). **Deletion resolves it** —
but any future integration feature must reuse `notification-preferences/secrets.ts`, not repeat this.

### 6b. Are configured plugin secrets returned to clients? Mostly no — one deliberate exception

- **Generic webhook:** masked only — `generic-webhook-integration/index.ts:46-47`
  (`secretConfigured: Boolean(config.secret)`, `maskedSecret: maskValue(config.secret)`). Good.
- **Gitea access token:** masked only — `get-gitea-integration.ts:10-15`, `:44`. Good.
- **Gitea webhook secret:** returned **in full** when `includeWebhookSecret === true`
  (`get-gitea-integration.ts:19`, `:46`). Call sites: `gitea-integration/index.ts:253` and `:310`,
  both behind `manageAccess = [workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] })]` (`gitea-integration/index.ts:43-46`).
  The read-only GET at `:234` passes the default `false`. This is a **deliberate, documented,
  permission-gated** choice (`gitea-integration/response.ts:3-4`, `:18-22`: "Only returned to
  callers with workspace:manage_settings, so the value can be pasted into Gitea") and I consider it
  **acceptable, not a finding** — the value must be transcribable into Gitea's UI. Flagging it only
  so the reviewer of #6 knows it exists. **Resolved by #6.**
- **GitHub App private key / webhook secret:** env-only, never in a response
  (`github/utils/github-app.ts:19-54`). Fine.

---

## 7. The plugin registry — `apps/api/src/plugins/registry.ts` (KEEP)

### 7a. Cross-tenant reach: the registry itself is correctly scoped
`getActiveIntegrations(projectId)` (`registry.ts:242-252`) filters on
`eq(integrationTable.projectId, projectId)` **and** `eq(integrationTable.isActive, true)`, and every
`broadcast*` function derives `projectId` from the event, not from anything a plugin returns.
Plugin *configuration* is likewise reach-scoped at the HTTP layer — every mutating route on every
integration router carries `workspaceAccess.fromProject("projectId")` +
`requireWorkspacePermission({ workspace: ["manage_settings"] })`:
`github-integration/index.ts:39-42`, `gitea-integration/index.ts:43-46`,
`slack-integration/index.ts:80-83`, `discord-integration/index.ts:82-85`,
`generic-webhook-integration/index.ts:75-78`, and `scopeToProjectFromBody`
(`integrations/middleware.ts:9-41`) for body-scoped routes. **No tenant can enable or configure a
plugin for another tenant through the registry or the routers.** I looked for this specifically
and did not find a hole.

### FINDING D-15 — `registry.ts` (KEEP) hard-depends on `integrationTable`, which #6 deletes
**Severity: HIGH (delivery/coupling)** · **THIS IS THE #6 COUPLING FLAG**
**File:** `apps/api/src/plugins/registry.ts:2-3, 242-252, 254-264`

```ts
import db from "../database";                                     // :2
import { integrationTable } from "../database/schema";            // :3
...
async function getActiveIntegrations(projectId: string) {         // :242
  return db.query.integrationTable.findMany({
    where: and(eq(integrationTable.projectId, projectId),         // :245
               eq(integrationTable.isActive, true)),
    with: { project: true },
  });
}
```

The plan of record keeps `registry.ts` + `types.ts` "as the seed of `plugins-contracts`"
(`docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/README.md:33`) while dropping the
`integration` table in the same breath. Every one of the eleven `broadcast*` functions in this file
(`:264` through `:489`) calls `getActiveIntegrations`, so the KEEP file does not compile — let alone
run — once the table is gone. `apps/api/src/plugins/index.ts:1-22` compounds it: `initializePlugins()`
statically imports and registers all six doomed plugins (`:12-17`) before calling
`initializeEventSubscriptions()` (`:19`), so the registry's event wiring is entangled with the
deletion set too.

**Fix:** decide explicitly, and record it in `decision-log.md`. Either (a) keep the `integration`
table as the generic plugin-config store and say so, or (b) reduce `registry.ts` to a pure
in-memory contract (`registerPlugin`/`getPlugin`/`listPlugins`, `:24-29`, `:232-238`) with the
DB-backed `getActiveIntegrations` + all eleven `broadcast*` functions moved out or deleted, and
split `initializePlugins()` so the registry no longer imports the six plugin directories.

**Owning issue:** #6, blocking. Must be resolved as part of the deletion, not after.

### FINDING D-16 — One malformed `integration.config` row silently kills the whole broadcast for that project
**Severity: LOW** · **SURVIVES #6**
**File:** `apps/api/src/plugins/registry.ts:254-264` and every `broadcast*` loop, e.g. `:270-283`

```ts
function createContext(integration: { id; projectId; config: string }): PluginContext {
  return { ..., config: JSON.parse(integration.config) as Record<string, unknown> };  // :262
}
...
for (const integration of integrations) {
  const plugin = getPlugin(integration.type);
  if (!plugin?.onTaskCreated) continue;
  const context = createContext(integration);          // :275  <- OUTSIDE the try
  try { await plugin.onTaskCreated(event, context); }  // :278
  catch (error) { console.error(...); }                // :279-281
}
```

`createContext` is called **outside** the `try`, and `JSON.parse` at `:262` is unguarded. A single
corrupt config row throws out of the `for` loop, so every *later* integration for that project is
silently skipped. It does not crash the process — `events/index.ts:46-51` wraps each handler in a
try/catch — so the failure is invisible except for one `console.error` per event. Note that
`createContext` also does no schema validation; whatever JSON is in the row becomes
`context.config` and is handed to the plugin as trusted.

**Fix:** move `createContext` inside the try, or return `null` on parse failure and `continue`.
Validate with the plugin's own valibot schema before use. Also collapse the eleven near-identical
`broadcast*` bodies into one generic dispatcher — the duplication is why the bug is in all eleven.

**Owning issue:** NEW ISSUE (or #6 if `registry.ts` is rewritten there).

---

## 8. Trusting remote-controlled data

### FINDING D-17 — GitHub repo squatting: linking a repo requires no proof of ownership, and inbound webhooks fan out by repo name across **all** tenants
**Severity: HIGH** · **RESOLVED BY #6 DELETION**
**Files:** `apps/api/src/plugins/github/services/task-service.ts:125-140`,
`apps/api/src/github-integration/controllers/create-github-integration.ts:59-69`

```ts
export async function findAllIntegrationsByRepo(owner: string, repo: string) {   // :125
  const integrations = await db.query.integrationTable.findMany({
    where: and(eq(integrationTable.type, "github"),
               eq(integrationTable.isActive, true)),        // :127-129  — NO tenant scoping
    with: { project: true },
  });
  return integrations.filter((integration) => {
    const config = JSON.parse(integration.config);
    return config.repositoryOwner === owner && config.repositoryName === repo;   // :138
  });
}
```

Inbound GitHub events are routed to projects by **remote-supplied** `payload.repository.owner.login`
/ `payload.repository.name` (`github/webhooks/issue-opened.ts:50-53`, and the same call in
`issue-reopened.ts:30`, `pull-request-opened.ts:37`, `pull-request-closed.ts:37`), against a query
with no workspace/project filter. The signature is valid for *any* installation of the single
instance-wide GitHub App (`github/utils/github-app.ts:45-51`), so "signed" says nothing about which
tenant the event belongs to.

The only defence is a first-come-first-served uniqueness check in the create controller
(`create-github-integration.ts:33-57`) that 409s if another project already claims the same
`owner/repo`. Crucially, **ownership is never verified**:

```ts
try {
  const { data: installation } = await githubApp.octokit.rest.apps.getRepoInstallation({ owner, repo });
  installationId = installation.id;                                    // :66
} catch (error) {
  console.warn("Could not get installation ID for repository:", error); // :68  <- warn only
}
// ...creation proceeds regardless, with installationId = null
```

**Attack path:** attacker signs up, creates a workspace, and links `victim-org/private-repo` —
a repo they have no relationship with. `getRepoInstallation` fails, is warned, creation succeeds.
Two payoffs:
1. **Squatting / denial:** the victim can now never link their own repo — they get
   `409 "Repository victim-org/private-repo is already linked to another project"`
   (`:48-50`), which is also a **cross-tenant enumeration oracle**: the attacker can probe which
   `owner/repo` pairs any other tenant on the instance has linked.
2. **Cross-tenant data exfiltration:** the moment the victim's org installs the App (org-wide
   installs are the norm), every `issues.opened` / `issue_comment` / `pull_request` event for that
   private repo is delivered by GitHub, passes the global-secret signature check, and
   `findAllIntegrationsByRepo` hands it to the **attacker's** project, which materialises issue
   titles, bodies and comments as tasks in the attacker's workspace
   (`issue-opened.ts:57-80` onwards).

I checked and rejected a related hypothesis: the **update** route cannot be used to re-point an
existing integration at another repo — `github-integration/index.ts:270-322` only merges
`commentTaskLinkOnGitHubIssue` and `isActive` into the stored config, and never reads a repo from
the body. So create-time squatting is the only vector.

Also note the scalability/DoS shape: both `findAllIntegrationsByRepo:126` and
`create-github-integration.ts:33` load **every** GitHub integration row on the instance and filter
in JavaScript, on every webhook and every create.

**Fix:** verify the caller's App installation actually covers `owner/repo` before creating the row
(make the `getRepoInstallation` failure at `:67` fatal, not a warning), and scope the webhook
lookup by installation id rather than by repo name string.
**Owning issue:** #6 removals. **Deletion resolves it.** Live in `main` until then.

### 8b. Other remote-id handling — checked, no finding
- `gitea/webhook-handler.ts:74-127` routes by the **path** `integrationId`, then verifies against
  *that* integration's own secret (`:97-101`). Per-integration secret, no cross-tenant fan-out.
  This is the correct design and the GitHub path should have copied it.
- `findExternalLink(integration.id, "issue", issue.number.toString())` (`issue-opened.ts:64-68`)
  scopes the lookup by `integrationId`, so a remote issue number cannot reach another tenant's links.
- `plugins/telegram/client.ts:45-52` deserialises the remote JSON response but only reads `ok` and
  `description`; `description` flows into an `Error` message. Combined with D-06 that is
  remote-controlled text in logs — log-injection at worst. LOW, resolved by #6.
- `gitea/utils/gitea-api.ts:105-140` parses remote JSON; response consumption is bounded only by
  the 10s timeout — no `Content-Length`/body-size cap on any outbound client, including the
  surviving `delivery.ts:28`. A hostile or compromised webhook receiver can return an unbounded
  body into `await response.text()` (`delivery.ts:303`, `:346`, `:378`). **LOW/MEDIUM, SURVIVES #6** —
  worth a body-size cap in `fetchWithTimeout`.

---

## Findings index

| ID | Sev | Title | Key file:line | Owning issue | #6 resolves? |
|---|---|---|---|---|---|
| D-01 | HIGH | DNS rebinding — guard resolves once, never pins | `utils/assert-public-destination.ts:106-114` | NEW | No |
| D-02 | HIGH | Redirects followed on the surviving outbound path | `notification-preferences/delivery.ts:28` | NEW | No — #6 makes it worse |
| D-03 | HIGH | SSRF guard wrapper lives in a #6-deleted dir, imported by 2 KEEP files | `plugins/generic-webhook/config.ts:4-8` | #6 (pre-work) | No — it *breaks* on #6 |
| D-04 | MED | Deny-list gaps: multicast, broadcast, 6to4, NAT64, `fec0::/10`, `192.0.0/24`, `198.18/15`, `::7f00:1` | `utils/assert-public-destination.ts:12-23, 48-57` | NEW | No |
| D-05 | MED | Guard errors echoed to client → internal DNS oracle | `notification-preferences/service.ts:330-373` | NEW / #8 | No |
| D-06 | MED | Remote/internal response bodies embedded in errors, then logged | `notification-preferences/delivery.ts:378-380, 573-576` | NEW | Partly |
| D-07 | LOW | ntfy/Gotify validate one URL, fetch another | `notification-preferences/delivery.ts:286-289, 315-321` | NEW | No |
| D-08 | HIGH | Slack + Discord outbound posts entirely unguarded | `plugins/slack/client.ts:39`, `plugins/discord/client.ts:51` | #6 | **Yes** |
| D-09 | LOW | Telegram bot token unescaped in URL path (Gotify token in query survives) | `plugins/telegram/client.ts:26`; `delivery.ts:317-319` | #6 / NEW | Partly |
| D-10 | MED | `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` = global boolean bypass; docs call it an allowlist; slated for deletion though KEEP code reads it | `utils/assert-public-destination.ts:81-100`; `docs/04-engineering/repository-bootstrap.md:230` | #6 + NEW | No |
| D-11 | MED | No replay window / delivery-ID dedup on inbound webhooks | `plugins/gitea/webhook-handler.ts:74-127`; `plugins/github/webhook-handler.ts:35` | #6 | **Yes** |
| D-12 | LOW | Outbound `X-TaskDesk-Signature` unversioned, no timestamp | `notification-preferences/delivery.ts:366-370` | NEW | No |
| D-13 | MED | Encryption key = unsalted single SHA-256; plaintext legacy secrets silently accepted; env-var name drift | `notification-preferences/secrets.ts:13-20, 81-86` | NEW | No |
| D-14 | HIGH | Plugin secrets stored plaintext in `integration.config` | `database/schema.ts:867-892` | #6 | **Yes** |
| D-15 | HIGH | KEEP `registry.ts` hard-depends on the `integration` table #6 deletes | `plugins/registry.ts:2-3, 242-252` | #6 (blocking) | No — it *is* the #6 break |
| D-16 | LOW | Unguarded `JSON.parse` in `createContext` aborts the whole broadcast | `plugins/registry.ts:262, 275` | NEW / #6 | No |
| D-17 | HIGH | GitHub repo squatting + cross-tenant webhook fan-out by repo name | `plugins/github/services/task-service.ts:125-140`; `github-integration/controllers/create-github-integration.ts:59-69` | #6 | **Yes** |

**Survives #6 and needs its own work:** D-01, D-02, D-03, D-04, D-05, D-06 (partly), D-07, D-09
(Gotify half), D-10, D-12, D-13, D-15, D-16.

## Things I checked and found NOT vulnerable
Recorded so the next reviewer does not redo them:
- Userinfo-in-URL confusion (`http://evil@169.254.169.254/`, `http://169.254.169.254@evil.com/`) — the
  WHATWG parser gives `url.hostname` the true authority; the guard reads `.hostname`, so neither direction bypasses.
- Decimal / octal / hex / short-form IPv4 — normalised by `new URL()` before the guard sees them; blocked.
- Both spellings of IPv4-mapped IPv6, including the hex form the parser emits — blocked by `mappedIpv4:28-38`.
- `0.0.0.0` and `localhost` (any case) — blocked.
- Non-HTTP schemes — blocked at `:94`, and the check runs *before* the env escape hatch.
- GitHub integration **update** route as a repo-repointing bypass — not possible (`github-integration/index.ts:270-322`).
- Inbound Gitea signature: constant-time, raw body, fails closed with no secret — correct.
- Plugin *configuration* routes and `registry.ts:242-252` cross-tenant reach — properly workspace-scoped.
- Notification-preference signing secret leaking via API or log — not found; masked at `service.ts:212-213`.

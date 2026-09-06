# SeaweedFS — the opt-in `s3` profile

A fresh install does **not** run this. The active storage plugin is
`storage.filesystem`: attachment bytes on the `taskdesk-data` volume, no
credentials, no bucket, no third hostname. An administrator moves to
`storage.s3` from God Mode when they want to
([storage and attachments](../../docs/01-architecture/storage-and-attachments.md)).

`s3.json` — the static access key and secret SeaweedFS authenticates against —
is **generated once by `scripts/deploy.sh --profile s3`** and written with mode
`0600`. It is not version-controlled and there is no example to copy: a
committed example is a credential everyone shares.

Two constraints that are easy to get wrong, both stated in full in
[deployment.md](../../docs/05-operations/deployment.md):

- **The plugin's configured public endpoint must equal the browser-facing
  origin** (`https://files.<domain>`). An S3 SigV4 signature covers the `Host`
  header, so a URL presigned for the internal `seaweedfs:8333` endpoint does not
  verify when the browser fetches it at `files.<domain>`.
- **The bucket's own CORS** — not a Traefik middleware — is what admits the
  agent and portal origins, because a presigned POST goes from the browser
  straight to the storage endpoint.

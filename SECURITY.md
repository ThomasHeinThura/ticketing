# Security policy

## Supported versions

Security fixes go into the latest release and into `main`. Older releases are not patched, so upgrade to the newest tag before reporting a problem you found there.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through [GitHub security advisories](../../security/advisories/new) for this repository.

Include the version or commit, the steps to reproduce, and what an attacker gains. Say whether the problem needs a signed-in account and which role. Do not include real customer data.

We will acknowledge the report, agree on a fix and a disclosure date with you, and credit you in the advisory if you want that.

## Scope

In scope: the TaskDesk application, its container image, the Compose files and scripts in this repository, and the `@taskdesk/mcp` package. Out of scope: vulnerabilities in third-party software that you can reproduce without TaskDesk, and findings that need physical access to the server or the `.env` file.

## Verifying releases

Release images are signed with cosign. `scripts/deploy.sh` checks the signature before it pulls an image. See [Install and deploy](docs/guide/install-and-deploy.md#verify-the-signed-image).

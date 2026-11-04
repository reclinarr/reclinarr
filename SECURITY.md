# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/reclinarr/reclinarr/security/advisories/new). Please don't open a public issue, discussion or pull request for a security problem.

Include the affected version or commit, how Reclinarr is deployed (Docker image, source, which clients), and steps to reproduce. You'll get a reply within a week. Once a fix is released, the advisory is published and you're credited unless you'd rather not be.

## Supported versions

Fixes go into the latest release and `main`. Older releases are not patched, so update to the latest image before reporting.

## Scope

In scope: the Reclinarr API, the media plane in the Docker image, and the web, Android TV and mobile clients. Examples are authentication or session bypass, access to another user's data, leaking Jellyfin, Seerr or Dispatcharr credentials, server-side request forgery, and path traversal in the cache or library.

Vulnerabilities in Jellyfin, Seerr, Dispatcharr or other upstream services should be reported to those projects. If Reclinarr makes an upstream issue exploitable in a way it otherwise wouldn't be, report it here.

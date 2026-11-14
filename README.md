# Dokploy Plus

Modules for the official Dokploy dashboard without a fork: an application dashboard (Jellyfin, Home Assistant, Beszel and Uptime Kuma integrations), storage, mdadm RAID, SMART, memory, swap, Docker usage, container incidents, backups overview, Cloudflare analytics and DNS. Owner/admin sessions are checked against Dokploy. Only the owner can change extension settings.

## Install

**Recommended: as a Dokploy service** (one-click updates from Settings). In Dokploy, create a **Compose** service, choose **Raw** as the source, paste [`compose.yml`](compose.yml), adjust the commented options (SMART, Docker socket) and **Deploy**.

**Or with the Docker CLI**: clone this repository on the Linux host running Dokploy and run `docker compose up -d`. To build the images from source instead of pulling them: `docker compose -f compose.yml -f compose.build.yml up -d --build`.

Both pull the published images (`ghcr.io/fraustiz/dokploy-plus/proxy` and `/agent`, x86 and ARM). Then open your Dokploy domain and **Settings** in the sidebar to enable modules and connect services (Cloudflare, Jellyfin, Home Assistant, Beszel, Uptime Kuma, Discord). Each connection has a **Test connection** button that checks the values in the form before saving. Refresh the page after changing modules. No Cloudflare token is required for storage.

The dashboard is expected at `http://dokploy:3000` on `dokploy-network`. Traefik configuration must use a file-provider service pointing to that URL. The extension discovers its domain from Dokploy's configuration and writes a separate `dokploy-plus.yml`; it never rewrites `dokploy.yml`. HTML navigation falls back to Dokploy if the extension fails. Test compatibility after Dokploy updates: sidebar markup and shadcn classes can change.

For access by IP, publish `3001:3000` on the relay and set `TRAEFIK=off`; use that port to open Dokploy. HTTP and WebSocket traffic are relayed. HTTPS upstreams are not supported; terminate TLS at Traefik.

## Updates

Settings checks the latest [GitHub release](https://github.com/fraustiz/dokploy-plus/releases) (every 6 hours, from the server) and shows its release notes when a newer version exists.

- **Dokploy Raw compose installs**: the owner clicks **Update**. The extension pins its two images to the new version in its own compose file and asks Dokploy to redeploy it, using the owner's Dokploy session: no API key, Docker socket or extra privilege is involved. The page reloads when the new version answers. Keep the images on `ghcr.io/fraustiz/dokploy-plus/…` and do not set `pull_policy: never` on them.
- **CLI installs**: Settings shows the command to run in the repository folder: `git pull && docker compose pull && docker compose up -d`.

To pin a release by hand, replace `latest` with a tag such as `v0.12.1`. Set `UPDATE_CHECK=off` on the relay to disable the check (no request to GitHub is made then).

## Storage options

The default collector needs no privileged mode and reports virtual storage, memory and swap. The host root filesystem is measured through the mounted hostname file. To monitor another filesystem, mount a file or directory from it read-only and set `VOLUMES` to comma-separated `label=container-path` pairs, including the root entry if wanted.

For physical disks, set `SMART=auto`, add `privileged: true` and `/dev:/dev` to the collector. RAID and SMART are detected automatically. SMART checks avoid waking sleeping disks. For Docker usage, uncomment its socket mount. A Docker socket grants host-level power even when mounted read-only; keep the collector internal and publish no collector ports. No disk or volume mutation endpoints exist. Optional image cleanup is limited to untagged images older than seven days and unused by every container. It requires an owner session, a signed five-minute preview, explicit image selection and confirmation, and a shared agent token file. Eligibility is checked again before Docker deletes an image without force. Nothing is cleaned automatically.

## Settings and secrets

Settings persist in the `settings` Docker volume. Tokens/webhooks are encrypted with AES-256-GCM; the key lives in the same volume, so back up the whole volume. This protects accidental config-file disclosure, not host compromise. Secrets never return through the settings API. Blank secret inputs preserve their values; removal has a separate checkbox. Discord alerts need a configured webhook.

Cloudflare requires Zone Read, Analytics Read and DNS Edit for the zones you select. DNS mutations use the current owner/admin session and same-origin checks. Optional bootstrap variables: `CLOUDFLARE_TOKEN_FILE`, `DISCORD_WEBHOOK_FILE`, `MODULES` (`storage,cloudflare`); saved settings take precedence.

The extension uses English to match the official Dokploy dashboard.

## Uninstall

Run `docker compose down` (keep the settings volume for a later reinstall). Normal shutdown removes the generated Traefik file. After an unclean shutdown, remove `/etc/dokploy/traefik/dynamic/dokploy-plus.yml` manually if needed. Dokploy's official service and updates remain independent.

## Third-party code

Bundled cobe (MIT), adapted Coolify globe (Apache-2.0) and js-yaml (MIT) retain their license files beside the sources. No personal deployment files or credentials are included.

## Dashboard and Operations

Dashboard offers shared categories and HTTP(S) application cards. Owners configure cards with Customize; service URLs and encrypted tokens live in Settings. Integrations use a server-side connection to the root URL of each service; tokens never reach the browser on reads. Jellyfin exposes public availability/version without a token, and active playback with a token. Home Assistant requires a long-lived token and can show up to six configured entity states. Discord incident/storage alerts use the webhook saved in Settings.

Operations groups Docker usage by application labels. Shared images and volumes may appear in multiple groups, so their sizes are not additive. Container incidents include unhealthy state, observed restarts, OOM and recovery. Collection runs every minute and keeps up to 500 events and 24 hours of host disk/PSI samples in `/state`; keep the insights volume for persistence. An outage of the collector creates a gap, not retrospective incident coverage.

Backups reads Dokploy-managed schedules and runs using the caller's session, discards service credentials, and reports partial failures. It does not cover external backup scripts, schedule new backups, or certify restorability. Schedules are displayed as configured cron expressions.

To enable selective image cleanup, create a random token file (32 random bytes encoded in hex, permissions 600), mount that file at `/data/agent-token:ro` on the relay and `/run/secrets/agent-token:ro` on the agent. Keep it outside git. Cleanup is disabled without this token. Build caches, named images, volumes and containers are excluded.

## Beszel integration

Choose Beszel as a Dashboard card integration and use the Hub root URL. In Settings, save the email/password of a dedicated Beszel user with the readonly role, shared only with the systems to display. The relay authenticates to PocketBase server-side, caches the session in memory, and returns only system names, status, timestamps and selected CPU/memory/disk metrics. Login details stay encrypted in the settings volume and never return through the Dashboard API.

Server cards link to each system in Beszel. Metrics older than three minutes are marked stale and not displayed as current. No new Beszel agent or metrics database is installed by this integration. Beszel agents must already be registered with the Hub; an installed agent returning 401 is not collecting metrics.

## Uptime Kuma integration

Dashboard cards show the state of the matching Uptime Kuma monitor (up/down, 24-hour uptime, and the TLS certificate when it is invalid or expires within 14 days); the header counts monitored apps that are down. In Settings, enter the Kuma base URL and an API key created in Kuma (*Settings → API Keys*). The relay reads Kuma's authenticated `/metrics` endpoint server-side: no public status page is needed and the key never reaches the browser.

A monitor matches a card when its URL has the same host and path, or when it is the only monitor on that host (for example a card for `https://pihole.example/` and a monitor on `/admin/`). Monitors are created in Kuma itself; the API key only reads metrics.

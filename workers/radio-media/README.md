# VatioBoard Radio Media Worker

Restricted Cloudflare Worker for Radio Browser station streams and artwork. It accepts only UUID-based station routes and resolves every upstream URL independently.

For in-vehicle background playback and GPS validation, see [Tesla radio and GPS background validation](../../docs/tesla-radio-background-runbook.md).

## Local development

```sh
pnpm run radio:dev
```

The SPA uses `http://localhost:8787` automatically on localhost. For a hosted development SPA, set `VITE_VATIOBOARD_RADIO_MEDIA_BASE` to the HTTPS development Worker origin and add that SPA origin to `ALLOWED_ORIGINS` in the development Worker configuration.

The feature branch treats only `radio-media.dev.vatioboard.com` as operational. The production hostname is intentionally not required until the radio feature is merged and prepared for release.

## Hosted development on dev.vatioboard.com

The development deployment on this machine uses:

```text
https://dev.vatioboard.com
  -> Nginx -> Vite on 127.0.0.1:5174

https://radio-media.dev.vatioboard.com
  -> Nginx -> Wrangler/workerd on 127.0.0.1:8787
```

The radio hostname has its own DNS record and Let's Encrypt certificate. Wrangler remains bound to loopback; port `8787` must not be exposed directly.

### Repository configuration

Create the ignored file `.env.development.local`:

```dotenv
VITE_VATIOBOARD_RADIO_MEDIA_BASE=https://radio-media.dev.vatioboard.com
```

The `vars` section of `wrangler.dev.jsonc` must contain:

```jsonc
{
  "ALLOWED_ORIGINS": "https://dev.vatioboard.com,http://localhost:5174,http://127.0.0.1:5174",
  "SELF_HOSTNAME": "radio-media.dev.vatioboard.com",
  "BUILD_VERSION": "radio-media-dev-v2",
}
```

Restart both development processes after changing either file:

```sh
pnpm run radio:dev
pnpm run dev
```

Vite reads `.env.development.local` only at startup.

### Nginx relay virtual host

The enabled virtual host is `/etc/nginx/sites-enabled/radio-media.dev.vatioboard.com`. Its proxy location must preserve the browser origin and disable buffering so continuous audio is passed through immediately:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header CF-Connecting-IP $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    gzip off;

    proxy_connect_timeout 15s;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

After changing Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

### Hosted-development verification

Verify preflight and exact-origin CORS:

```sh
UUID=1cfb151d-a341-11e9-a787-52543be04c81

curl -i -X OPTIONS \
  "https://radio-media.dev.vatioboard.com/v1/stations/$UUID/stream" \
  -H "Origin: https://dev.vatioboard.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Range, Accept"
```

The response must be `204` and include:

```text
Access-Control-Allow-Origin: https://dev.vatioboard.com
Access-Control-Allow-Headers: Accept, Range
```

Verify the running development build and origin policy:

```sh
curl -i "https://radio-media.dev.vatioboard.com/v1/health" \
  -H "Origin: https://dev.vatioboard.com" \
  -H "Accept: application/json"
```

The response must be `200`, report `status: "ready"`, identify the development Worker version, and include the exact development origin. Missing, `null`, and unknown origins must return `403`.

Verify a real continuous HTTP station through the HTTPS relay:

```sh
curl -D - --max-time 5 \
  "https://radio-media.dev.vatioboard.com/v1/stations/$UUID/stream" \
  -H "Origin: https://dev.vatioboard.com" \
  -H "Accept: audio/*" \
  -o /dev/null
```

Expected headers include `200`, `Content-Type: audio/mpeg`, `Cache-Control: no-store`, and the exact allowed origin. Curl exit code `28` is expected after `--max-time` because a healthy radio stream does not end.

Probe the complete directory/redirect/upstream path without opening a continuous player connection:

```sh
curl -i \
  "https://radio-media.dev.vatioboard.com/v1/stations/$UUID/probe" \
  -H "Origin: https://dev.vatioboard.com" \
  -H "Accept: application/json"
```

A healthy station reports `outcome: "ready"`. Failures are categorical and never include the station URL.

Verify Media Session-compatible artwork with exact-origin CORS:

```sh
curl -I "https://radio-media.dev.vatioboard.com/v1/stations/$UUID/logo" \
  -H "Origin: https://dev.vatioboard.com"
```

The response must be `200` with a supported image content type. Finally, open `https://dev.vatioboard.com`, select Player -> Radio, and confirm the HTTP station displays `LIVE · RELAY` while the spectrum or scope visualizer receives data.

### Verified state

This configuration was validated on 2026-09-10:

- Both development hostnames resolved to the development server.
- The radio certificate matched `radio-media.dev.vatioboard.com` and was valid through 2026-12-09.
- Nginx was active and the Certbot renewal timer was enabled.
- Vite's transformed environment contained the HTTPS radio-media base.
- Allowed preflight returned `204`; a disallowed origin returned `403`.
- Exact-origin artwork returned a cached PNG.
- A real HTTP station returned continuous 128 kbps MP3 data through Nginx and the Worker.

The Vite and Wrangler processes are currently launched as interactive user processes. For unattended availability after logout or reboot, run them under the machine's process supervisor or dedicated systemd services.

## Cloudflare-hosted development alternative

The Nginx-to-local-Wrangler configuration above does not require a Cloudflare Worker deployment. To test a remotely deployed development Worker instead, deploy it before production rollout:

```sh
pnpm run radio:deploy:dev
```

Use the resulting HTTPS `workers.dev` URL as `VITE_VATIOBOARD_RADIO_MEDIA_BASE` for the hosted development SPA.

## Verification and deployment

```sh
pnpm run radio:typecheck
pnpm run radio:test
pnpm run verify
```

Do not include production connectivity in the feature-branch gate. When radio is ready to merge, create the production DNS/custom-domain route, configure production origins, deploy the Worker, generate its binding types, and run the same health, CORS, probe, and continuous-stream checks before switching the production SPA.

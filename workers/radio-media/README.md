# VatioBoard Radio Media Worker

Restricted Cloudflare Worker for Radio Browser station streams and artwork. It accepts only UUID-based station routes and resolves every upstream URL independently.

## Local development

```sh
pnpm run radio:dev
```

The SPA uses `http://localhost:8787` automatically on localhost. For a hosted development SPA, set `VITE_VATIOBOARD_RADIO_MEDIA_BASE` to the HTTPS development Worker origin and add that SPA origin to `ALLOWED_ORIGINS` in the development Worker configuration.

Deploy the development Worker before production rollout:

```sh
pnpm run radio:deploy:dev
```

Use the resulting HTTPS `workers.dev` URL as `VITE_VATIOBOARD_RADIO_MEDIA_BASE` for the hosted development SPA.

## Verification and deployment

```sh
pnpm run radio:typecheck
pnpm run radio:test
pnpm run radio:types
pnpm run radio:deploy
```

Production deployment requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The production configuration binds the custom domain `radio-media.vatioboard.com`, disables `workers.dev` and preview URLs, and leaves the main SPA deployment on GitHub Pages unchanged.

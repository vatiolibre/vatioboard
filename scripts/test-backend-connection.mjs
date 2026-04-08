#!/usr/bin/env node

/**
 * Quick console script to test connectivity to the VatioLibre backend API.
 *
 * Usage:
 *   node scripts/test-backend-connection.mjs            # uses dev API
 *   node scripts/test-backend-connection.mjs --prod      # uses production API
 */

const isProd = process.argv.includes('--prod');
const API_BASE = isProd
  ? 'https://api.vatioboard.com'
  : 'https://api.dev.vatioboard.com';

const TESTS = [
  {
    label: 'DNS + TLS handshake',
    run: () => fetch(`${API_BASE}/`, { method: 'HEAD', redirect: 'manual' }),
    check: (res) => `status ${res.status} — reachable`,
  },
  {
    label: 'Session probe (guest-safe)',
    run: () =>
      fetch(
        `${API_BASE}/api/method/vatiolibre.services.tesla_connection_status`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'follow',
        },
      ),
    check: (res) => `status ${res.status} — ${res.status < 500 ? 'API responding' : 'server error'}`,
  },
  {
    label: 'Cloud sync pull (unauthenticated)',
    run: () =>
      fetch(
        `${API_BASE}/api/method/vatiolibre.vatiolibre.cloud_sync.pull_my_sync_records`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'follow',
        },
      ),
    check: (res) => {
      if (res.status === 403 || res.status === 401) return `status ${res.status} — auth gate working (expected)`;
      if (res.status === 200) return `status 200 — endpoint open (guest session?)`;
      return `status ${res.status}`;
    },
  },
  {
    label: 'Feature access (unauthenticated)',
    run: () =>
      fetch(
        `${API_BASE}/api/method/vatiolibre.vatiolibre.feature_access.get_my_feature_access`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'follow',
        },
      ),
    check: (res) => {
      if (res.status === 403 || res.status === 401) return `status ${res.status} — auth gate working (expected)`;
      if (res.status === 200) return `status 200 — endpoint reachable`;
      return `status ${res.status}`;
    },
  },
];

console.log(`\nTesting VatioLibre backend: ${API_BASE}\n`);

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  const start = performance.now();
  try {
    const res = await test.run();
    const ms = (performance.now() - start).toFixed(0);
    const detail = test.check(res);
    console.log(`  ✓  ${test.label}  →  ${detail}  (${ms}ms)`);
    passed += 1;
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    console.log(`  ✗  ${test.label}  →  ${err.cause?.code || err.message}  (${ms}ms)`);
    failed += 1;
  }
}

console.log(`\nDone: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

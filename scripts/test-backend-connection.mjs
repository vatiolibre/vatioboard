#!/usr/bin/env node

/**
 * Validate the public VatioBoard BFF contract.
 *
 * Usage:
 *   node scripts/test-backend-connection.mjs
 *   node scripts/test-backend-connection.mjs --prod
 *   VATIOBOARD_CANARY_USER=... VATIOBOARD_CANARY_PASSWORD=... \
 *     node scripts/test-backend-connection.mjs --authenticated
 *
 * Canary credentials are read only from the process environment and are never
 * printed. Authenticated Tesla checks are cache-only and never wake or command
 * a vehicle.
 */

const isProd = process.argv.includes("--prod");
const runAuthenticated = process.argv.includes("--authenticated");
const API_BASE = isProd
  ? "https://api.vatioboard.com"
  : "https://api.dev.vatioboard.com";
const FRONTEND_ORIGIN = isProd
  ? "https://vatioboard.com"
  : "https://dev.vatioboard.com";

const METHOD = Object.freeze({
  session: "vatiolibre.vatiolibre.sso.status",
  teslaStatus: "vatiolibre.services.tesla_connection_status",
  teslaOrders: "vatiolibre.services.tesla_orders_enriched",
  teslaVehicles: "vatiolibre.services.tesla_vehicles",
  teslaVehicleData: "vatiolibre.services.tesla_vehicle_data",
  featureAccess: "vatiolibre.vatiolibre.feature_access.get_my_feature_access",
  cloudPull: "vatiolibre.vatiolibre.cloud_sync.pull_my_sync_changes",
  speedList: "vatiolibre.vatiolibre.cloud_sync.list_my_speed_recordings",
  accelList: "vatiolibre.vatiolibre.cloud_sync.list_my_accel_recordings",
  mediaList: "vatiolibre.vatiolibre.media_assets.list_my_media_assets",
  mediaManifest: "vatiolibre.vatiolibre.media_assets.get_my_media_manifest",
  playlistList: "vatiolibre.vatiolibre.media_playlists.list_my_media_playlists",
  boardList: "vatiolibre.vatiolibre.board_documents.list_my_board_documents",
});

let passed = 0;
let failed = 0;

function methodUrl(methodName, query) {
  const url = new URL(`${API_BASE}/api/method/${methodName}`);
  for (const [key, value] of Object.entries(query || {})) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(response, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(
    allowed.includes(response.status),
    `expected status ${allowed.join(" or ")}, received ${response.status}`,
  );
}

function assertCors(response) {
  assert(
    response.headers.get("access-control-allow-origin") === FRONTEND_ORIGIN,
    "missing or incorrect Access-Control-Allow-Origin",
  );
  assert(
    response.headers.get("access-control-allow-credentials") === "true",
    "missing Access-Control-Allow-Credentials",
  );
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("application/json"), `expected JSON, received ${contentType || "no content type"}`);
  try {
    return await response.json();
  } catch {
    throw new Error("response body is not valid JSON");
  }
}

function getMessage(data) {
  return data && typeof data === "object" && data.message && typeof data.message === "object"
    ? data.message
    : {};
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  const cookies = values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean);
  assert(cookies.some((value) => value.startsWith("sid=")), "login did not issue a session cookie");
  return cookies.join("; ");
}

async function requestMethod(methodName, {
  method = "GET",
  query,
  body,
  cookie,
  headers,
} = {}) {
  return fetch(methodUrl(methodName, query), {
    method,
    redirect: "manual",
    headers: {
      Accept: "application/json",
      Origin: FRONTEND_ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(headers || {}),
    },
    body,
  });
}

async function check(label, callback) {
  const started = performance.now();
  try {
    const detail = await callback();
    const elapsed = (performance.now() - started).toFixed(0);
    console.log(`  ✓  ${label}  →  ${detail}  (${elapsed}ms)`);
    passed += 1;
  } catch (error) {
    const elapsed = (performance.now() - started).toFixed(0);
    console.log(`  ✗  ${label}  →  ${error.message}  (${elapsed}ms)`);
    failed += 1;
  }
}

async function runGuestChecks() {
  await check("DNS + TLS handshake", async () => {
    const response = await fetch(`${API_BASE}/`, {
      method: "HEAD",
      redirect: "manual",
    });
    assertStatus(response, 200);
    return "status 200";
  });

  await check("Session probe (guest-safe GET)", async () => {
    const response = await requestMethod(METHOD.session);
    assertStatus(response, 200);
    assertCors(response);
    const message = getMessage(await readJson(response));
    assert(message.is_guest === true, "guest session was not identified");
    return "status 200, guest contract valid";
  });

  await check("Tesla status (guest-safe POST)", async () => {
    const response = await requestMethod(METHOD.teslaStatus, { method: "POST" });
    assertStatus(response, 200);
    assertCors(response);
    const message = getMessage(await readJson(response));
    assert(message.is_guest === true, "Tesla status did not identify the guest session");
    assert(message.connected === false, "guest Tesla status must not be connected");
    return "status 200, POST contract valid";
  });

  await check("Cloud sync auth gate", async () => {
    const response = await requestMethod(METHOD.cloudPull);
    assertStatus(response, [401, 403]);
    await readJson(response);
    return `status ${response.status}, auth gate valid`;
  });

  await check("Feature access auth gate", async () => {
    const response = await requestMethod(METHOD.featureAccess);
    assertStatus(response, [401, 403]);
    await readJson(response);
    return `status ${response.status}, auth gate valid`;
  });
}

async function runAuthenticatedChecks() {
  const username = String(process.env.VATIOBOARD_CANARY_USER || "").trim();
  const password = String(process.env.VATIOBOARD_CANARY_PASSWORD || "");
  assert(username && password, "authenticated checks require canary credentials in the process environment");

  let cookie = "";
  await check("Canary login", async () => {
    const body = new URLSearchParams({ usr: username, pwd: password });
    const response = await requestMethod("login", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    assertStatus(response, 200);
    await readJson(response);
    cookie = cookieHeader(response);
    return "status 200, session cookie issued";
  });
  if (!cookie) return;

  await check("Authenticated session recognition", async () => {
    const response = await requestMethod(METHOD.session, { cookie });
    assertStatus(response, 200);
    const message = getMessage(await readJson(response));
    assert(message.is_guest === false, "authenticated session was reported as guest");
    assert(typeof message.user === "string" && message.user !== "Guest", "authenticated user is missing");
    return "status 200, authenticated";
  });

  let featureMessage = {};
  await check("Feature access", async () => {
    const response = await requestMethod(METHOD.featureAccess, { cookie });
    assertStatus(response, 200);
    featureMessage = getMessage(await readJson(response));
    assert(featureMessage.features && typeof featureMessage.features === "object", "feature map is missing");
    return featureMessage.has_active_subscription === true
      ? "status 200, active subscription"
      : "status 200, subscription inactive";
  });

  const protectedReads = [
    ["Cloud sync pull", METHOD.cloudPull, { limit: 1 }, "records"],
    ["Speed recordings", METHOD.speedList, { limit: 1 }, "records"],
    ["Acceleration recordings", METHOD.accelList, { limit: 1 }, "records"],
    ["Media assets", METHOD.mediaList, { limit: 1 }, "assets"],
    ["Media manifest", METHOD.mediaManifest, {}, "assets"],
    ["Playlists", METHOD.playlistList, { limit: 1 }, "playlists"],
    ["Board documents", METHOD.boardList, { limit: 1 }, "documents"],
  ];

  for (const [label, methodName, query, collectionKey] of protectedReads) {
    await check(label, async () => {
      const response = await requestMethod(methodName, { cookie, query });
      assertStatus(response, 200);
      const message = getMessage(await readJson(response));
      assert(Array.isArray(message[collectionKey]), `${collectionKey} collection is missing`);
      return `status 200, ${message[collectionKey].length} returned`;
    });
  }

  let vehicles = [];
  await check("Tesla connection", async () => {
    const response = await requestMethod(METHOD.teslaStatus, {
      method: "POST",
      cookie,
    });
    assertStatus(response, 200);
    const message = getMessage(await readJson(response));
    assert(message.connected === true, "canary Tesla account is not connected");
    return "status 200, connected";
  });

  await check("Tesla orders (cache-only POST)", async () => {
    const response = await requestMethod(METHOD.teslaOrders, {
      method: "POST",
      cookie,
      body: new URLSearchParams({ force_refresh: "0" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assertStatus(response, 200);
    const message = getMessage(await readJson(response));
    assert(Array.isArray(message.orders), "orders collection is missing");
    return `status 200, ${message.orders.length} returned`;
  });

  await check("Tesla vehicles (cache-only POST)", async () => {
    const response = await requestMethod(METHOD.teslaVehicles, {
      method: "POST",
      cookie,
      body: new URLSearchParams({ force_refresh: "0" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assertStatus(response, 200);
    const message = getMessage(await readJson(response));
    assert(Array.isArray(message.vehicles), "vehicles collection is missing");
    vehicles = message.vehicles;
    return `status 200, ${vehicles.length} returned`;
  });

  if (vehicles.length) {
    await check("Tesla vehicle data (no-wake POST)", async () => {
      const vehicleId = String(vehicles[0]?.id || vehicles[0]?.vehicle_id || "");
      assert(vehicleId, "cached vehicle has no identifier");
      const response = await requestMethod(METHOD.teslaVehicleData, {
        method: "POST",
        cookie,
        body: new URLSearchParams({
          vehicle_id: vehicleId,
          force_refresh: "0",
          skip_wake: "1",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      assertStatus(response, 200);
      await readJson(response);
      return "status 200, skip_wake=1";
    });
  }
}

console.log(`\nTesting VatioLibre backend contract: ${API_BASE}\n`);
await runGuestChecks();
if (runAuthenticated) {
  try {
    await runAuthenticatedChecks();
  } catch (error) {
    console.log(`  ✗  Authenticated setup  →  ${error.message}`);
    failed += 1;
  }
}

console.log(`\nDone: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

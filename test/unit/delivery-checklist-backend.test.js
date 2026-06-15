import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TESLA_ORDERS_ENRICHED_METHOD,
  TESLA_VEHICLES_METHOD,
  TESLA_VEHICLE_DATA_METHOD,
  clearBackendAccessCache,
  getBackendTeslaConnectionStatus,
  getBackendTeslaVehicleData,
  listBackendTeslaOrders,
  listBackendTeslaVehicles,
} from "../../src/shared/backend-auth.js";

const TEST_CONFIG = {
  apiBase: "https://api.test.example",
  backendEnabled: true,
};

function jsonResponse(message, status = 200) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("delivery checklist backend Tesla wrappers", () => {
  afterEach(() => {
    clearBackendAccessCache();
    vi.restoreAllMocks();
  });

  it("loads enriched Tesla orders through the expected VatioLibre method URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      connected: true,
      orders: [
        {
          referenceNumber: "RN123",
          modelCode: "my",
        },
      ],
      cached: false,
    }));

    const result = await listBackendTeslaOrders({
      forceRefresh: true,
      fetchImpl,
      config: TEST_CONFIG,
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.origin).toBe("https://api.test.example");
    expect(url.pathname).toBe(`/api/method/${TESLA_ORDERS_ENRICHED_METHOD}`);
    expect(url.searchParams.get("force_refresh")).toBe("1");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      method: "GET",
    });
    expect(result.orders).toHaveLength(1);
    expect(result.connected).toBe(true);
  });

  it("loads vehicles with force_refresh and normalizes guest/local-only states", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      connected: true,
      vehicles: [
        {
          id: 42,
          vin: "VIN42",
        },
      ],
      fetched_at: "2026-06-14T12:00:00",
    }));

    const result = await listBackendTeslaVehicles({
      forceRefresh: true,
      fetchImpl,
      config: TEST_CONFIG,
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe(`/api/method/${TESLA_VEHICLES_METHOD}`);
    expect(url.searchParams.get("force_refresh")).toBe("1");
    expect(result.vehicles[0]).toMatchObject({ id: 42 });
    expect(result.fetchedAt).toBe("2026-06-14T12:00:00");
  });

  it("requests vehicle data with skip_wake=1 by default", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: false,
      skipped_wake: true,
      vehicle_state: "asleep",
      error: "Wake skipped (skip_wake=1).",
    }));

    const result = await getBackendTeslaVehicleData({
      vehicleId: "123456",
      fetchImpl,
      config: TEST_CONFIG,
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe(`/api/method/${TESLA_VEHICLE_DATA_METHOD}`);
    expect(url.searchParams.get("vehicle_id")).toBe("123456");
    expect(url.searchParams.get("skip_wake")).toBe("1");
    expect(result.skippedWake).toBe(true);
    expect(result.vehicleState).toBe("asleep");
  });

  it("allows an explicit wake request only when callers opt out of skipWake", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      response: {
        vin: "VIN123",
      },
    }));

    await getBackendTeslaVehicleData({
      vehicleId: "123456",
      skipWake: false,
      fetchImpl,
      config: TEST_CONFIG,
    });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("skip_wake")).toBe("0");
  });

  it("returns local-only manual-mode data when backend calls are disabled", async () => {
    const fetchImpl = vi.fn();
    const disabledConfig = {
      ...TEST_CONFIG,
      backendEnabled: false,
    };

    const status = await getBackendTeslaConnectionStatus({
      fetchImpl,
      config: disabledConfig,
    });
    const orders = await listBackendTeslaOrders({
      fetchImpl,
      config: disabledConfig,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(status).toMatchObject({
      localOnly: true,
      isGuest: true,
      connected: false,
    });
    expect(orders).toMatchObject({
      localOnly: true,
      isGuest: true,
      orders: [],
    });
  });
});

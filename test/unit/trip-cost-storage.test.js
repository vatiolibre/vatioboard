import { beforeEach, describe, expect, it, vi } from "vitest";

describe("trip-cost storage", () => {
  let storage;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    storage = await import("../../src/energy/trip-cost-storage.js");
  });

  it("persists and normalizes trip cost settings", () => {
    storage.saveTripCostSettings({ unit: "mi", mode: "multi" });
    expect(storage.loadTripCostSettings()).toEqual({ unit: "mi", mode: "multi" });

    localStorage.setItem("energy_trip_cost_settings_v1", JSON.stringify({ unit: "bad", mode: "bad" }));
    expect(storage.loadTripCostSettings()).toEqual(storage.DEFAULT_SETTINGS);
  });

  it("merges stored values with defaults", () => {
    storage.saveTripCostValues({ distance: "120", consumption: "18", price: "0.21" });
    expect(storage.loadTripCostValues()).toEqual({
      distance: "120",
      consumption: "18",
      price: "0.21",
    });

    localStorage.setItem("energy_trip_cost_values_v1", JSON.stringify({ distance: "75", price: "0.18" }));
    expect(storage.loadTripCostValues()).toEqual({
      distance: "75",
      consumption: "",
      price: "0.18",
    });
  });

  it("restores multi-trip ids from storage before creating new trips", () => {
    const trips = [
      { id: 2, name: "Trip 1" },
      { id: 7, name: "Trip 2" },
    ];

    storage.saveMultiTrips(trips);
    expect(storage.loadMultiTrips()).toEqual(trips);
    expect(storage.createNewTrip(3)).toMatchObject({
      id: 8,
      name: "Trip 3",
      expanded: true,
    });
  });

  it("clears stored trips and resets the generated ids", () => {
    storage.saveMultiTrips([{ id: 4, name: "Trip 1" }]);
    storage.loadMultiTrips();

    storage.clearAllTrips();

    expect(localStorage.getItem("energy_multi_trip_v1")).toBeNull();
    expect(storage.createNewTrip(1)).toMatchObject({
      id: 1,
      name: "Trip 1",
      expanded: true,
    });
  });
});

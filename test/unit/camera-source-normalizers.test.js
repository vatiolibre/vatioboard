import { describe, expect, it } from "vitest";
import {
  attachNycTicketStats,
  normalizeAnsvCameraGeoJson,
  normalizeNycCameraGeoJson,
  normalizeNycTicketGeoJson,
} from "../../scripts/camera-source-normalizers.mjs";

function feature(coordinates, properties = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
  };
}

describe("camera source normalizers", () => {
  it("normalizes ANSV official camera records with speed and provenance", () => {
    const records = normalizeAnsvCameraGeoJson({
      type: "FeatureCollection",
      features: [
        feature([-73.412258, 7.805028], {
          request_code: "SOL0000015205",
          operation_status: "Operando",
          department: "CESAR",
          municipality: "SAN ALBERTO",
          address: "RUTA 4514 SENTIDO NORTE-SUR",
          infractions: "C24, C29",
          speed: "90.0",
          jurisdiction: "Departamental",
          transit_authority: "INSTITUTO",
          technology_type: "Radar Doppler",
          installation_type: "Fijo",
          device_name: "C2NS",
        }),
        feature([300, 7.8], { speed: "60.0" }),
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      country: "co",
      speedKph: 90,
      speedMeta: { source: "official:ansv:speed", confidence: "high", raw: "90.0" },
      sourceMeta: expect.objectContaining({
        primarySource: "ansv",
        official: true,
        active: true,
        region: "CESAR",
        locality: "SAN ALBERTO",
        jurisdiction: "Departamental",
        infractions: ["C24", "C29"],
        directions: ["NORTE-SUR"],
      }),
    });
  });

  it("normalizes NYC local camera records without inventing a speed", () => {
    const records = normalizeNycCameraGeoJson({
      type: "FeatureCollection",
      features: [
        feature([-73.9097138, 40.7421843], {
          id: 1,
          name: "Queens Bv b/t 58 St and 53 St",
          origName: ["WB QUEENS BV 58 ST -53 ST"],
        }),
      ],
    });

    expect(records[0]).toMatchObject({
      country: "us",
      region: "NY",
      speedKph: null,
      speedMeta: null,
      sourceMeta: expect.objectContaining({
        primarySource: "nyc",
        locality: "New York City",
        directions: ["WB"],
      }),
    });
  });

  it("joins NYC ticket statistics by original camera name", () => {
    const cameras = normalizeNycCameraGeoJson({
      type: "FeatureCollection",
      features: [
        feature([-73.9097138, 40.7421843], {
          id: 1,
          name: "Queens Bv b/t 58 St and 53 St",
          origName: ["WB QUEENS BV 58 ST -53 ST"],
        }),
      ],
    });
    const tickets = normalizeNycTicketGeoJson({
      type: "FeatureCollection",
      features: [
        feature([-73.9097138, 40.7421843], {
          name: "Queens Bv b/t 58 St and 53 St",
          origName: ["WB QUEENS BV 58 ST -53 ST"],
          dates: [
            { date: "2014-01-16", tickets: 2 },
            { date: "2026-03-18", tickets: 3 },
          ],
        }),
      ],
    });

    const joined = attachNycTicketStats(cameras, tickets);

    expect(joined[0].sourceMeta.sources).toContain("nyc-tickets");
    expect(joined[0].sourceMeta.ticketStats).toMatchObject({
      totalTickets: 5,
      firstDate: "2014-01-16",
      lastDate: "2026-03-18",
    });
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAnsvCameraGeoJson,
  convertAnsvCsvToGeoJson,
  parseCsv,
} from "../../scripts/build-ansv-cameras.mjs";

const tempDirs = [];

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vatioboard-ansv-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const CSV_HEADER = [
  "Acciones",
  "Código solicitud",
  "Código unico",
  "Estado operación",
  "Departamento",
  "Municipio",
  "Fecha aprobación",
  "Dirección",
  "Autoridad de tránsito",
  "Jurisdicción",
  "Infracciones",
  "Velocidad",
  "Tipo de tecnología",
  "Tipo de instalación",
  "Nombre equipo",
  "Latitud",
  "Longitud",
  "Código equipo",
  "Resolución de renovación",
  "Fecha radicación de renovación",
  "Fecha de notificación",
  "Fecha de recurso",
  "Fecha resolución de recurso",
  "Fecha de aprobación final",
  "Fecha finalización de prórroga",
  "Fecha inicio de operación",
  "Fecha finalización inicial",
].join(",");

describe("build-ansv-cameras", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsv('name,notes\nA,"one, two"\nB,"escaped ""quote"""')).toEqual([
      ["name", "notes"],
      ["A", "one, two"],
      ["B", 'escaped "quote"'],
    ]);
  });

  it("converts ANSV CSV rows to normalized camera GeoJSON", () => {
    const csv = [
      CSV_HEADER,
      [
        "",
        "SOL0000015205",
        "",
        "Autorizada instalar",
        "CESAR",
        "SAN ALBERTO",
        "11/03/2026",
        '"Vía San Alberto - La Mata, Ruta 4514 PR 3+894 Sentido Norte-Sur"',
        "INSTITUTO",
        "Departamental",
        '"C.24, C.29, D.2"',
        "90",
        "Radar Doppler",
        "Fijo",
        "C2NS",
        "7.805028",
        "-73.412258",
        "",
        "",
        "",
        "12/12/2025",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
      [
        "",
        "SOL0000000000",
        "",
        "Operando",
        "CESAR",
        "SAN ALBERTO",
        "11/03/2026",
        "Invalid coordinate row",
        "INSTITUTO",
        "Departamental",
        "C.29",
        "None",
        "Radar Doppler",
        "Fijo",
        "C1",
        "not-a-latitude",
        "-73.412258",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    ].join("\n");

    const { geojson, skippedRows } = convertAnsvCsvToGeoJson(csv);

    expect(skippedRows).toBe(1);
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0]).toEqual({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [-73.412258, 7.805028],
      },
      properties: expect.objectContaining({
        request_code: "SOL0000015205",
        operation_status: "Autorizada instalar",
        department: "CESAR",
        municipality: "SAN ALBERTO",
        approval_date: "2026-03-11",
        address: "Vía San Alberto - La Mata, Ruta 4514 PR 3+894 Sentido Norte-Sur",
        infractions: "C24, C29, D02",
        speed: "90.0",
        notification_date: "2025-12-12",
      }),
    });
  });

  it("writes the generated ANSV GeoJSON file", async () => {
    const dir = await makeTempDir();
    const inputPath = path.join(dir, "ANSV.csv");
    const outputPath = path.join(dir, "ansv.geojson");
    await fs.writeFile(inputPath, `${CSV_HEADER}\n,,,,,,,,,,,,,,,4.6,-74.1,,,,,,,,,,\n`);

    const result = await buildAnsvCameraGeoJson({ inputPath, outputPath });
    const geojson = JSON.parse(await fs.readFile(outputPath, "utf8"));

    expect(result).toMatchObject({ featureCount: 1, skippedRows: 0 });
    expect(geojson.features[0].geometry.coordinates).toEqual([-74.1, 4.6]);
  });
});

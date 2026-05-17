import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_ANSV_CSV_PATH = path.resolve(projectRoot, "data-src/ANSV.csv");
export const DEFAULT_ANSV_GEOJSON_PATH = path.resolve(projectRoot, "data-src/ansv_cameras_maplibre.geojson");

const PROPERTY_COLUMNS = {
  request_code: "codigo solicitud",
  unique_code: "codigo unico",
  operation_status: "estado operacion",
  department: "departamento",
  municipality: "municipio",
  approval_date: "fecha aprobacion",
  address: "direccion",
  transit_authority: "autoridad de transito",
  jurisdiction: "jurisdiccion",
  infractions: "infracciones",
  speed: "velocidad",
  technology_type: "tipo de tecnologia",
  installation_type: "tipo de instalacion",
  device_name: "nombre equipo",
  device_code: "codigo equipo",
  renewal_resolution: "resolucion de renovacion",
  renewal_filing_date: "fecha radicacion de renovacion",
  notification_date: "fecha de notificacion",
  appeal_date: "fecha de recurso",
  appeal_resolution_date: "fecha resolucion de recurso",
  final_approval_date: "fecha de aprobacion final",
  extension_end_date: "fecha finalizacion de prorroga",
  operation_start_date: "fecha inicio de operacion",
  initial_end_date: "fecha finalizacion inicial",
};

const DATE_PROPERTIES = new Set([
  "approval_date",
  "renewal_filing_date",
  "notification_date",
  "appeal_date",
  "appeal_resolution_date",
  "final_approval_date",
  "extension_end_date",
  "operation_start_date",
  "initial_end_date",
]);

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isNullToken(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return !normalized || ["none", "null", "nan", "n/a"].includes(normalized);
}

function cleanCell(value) {
  if (isNullToken(value)) return null;
  return String(value).trim();
}

function parseCoordinate(value) {
  const number = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(number) ? Number(number.toFixed(6)) : null;
}

function isValidCoordinate(lon, lat) {
  return Number.isFinite(lon)
    && Number.isFinite(lat)
    && lon >= -180
    && lon <= 180
    && lat >= -90
    && lat <= 90;
}

function normalizeDate(value) {
  const text = cleanCell(value);
  if (!text) return null;

  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return text;
}

function normalizeSpeed(value) {
  const text = cleanCell(value);
  if (!text) return null;

  const normalized = text.replace(",", ".");
  const speed = Number(normalized);
  if (!Number.isFinite(speed)) return text;

  return Number.isInteger(speed) ? `${speed}.0` : String(speed);
}

function normalizeInfractionToken(value) {
  const compact = String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^([A-Z])\.?(\d+)$/);
  if (!match) return compact || null;
  const [, prefix, number] = match;
  return `${prefix}${number.padStart(2, "0")}`;
}

function normalizeInfractions(value) {
  const text = cleanCell(value);
  if (!text) return null;

  const infractions = Array.from(new Set(
    text
      .split(",")
      .map(normalizeInfractionToken)
      .filter(Boolean),
  ));
  return infractions.length ? infractions.join(", ") : null;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("ANSV CSV has an unterminated quoted field.");

  row.push(field);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  return rows;
}

function rowValue(row, indexByHeader, normalizedHeader) {
  const index = indexByHeader.get(normalizedHeader);
  return index === undefined ? null : row[index];
}

function createHeaderIndex(headers) {
  const indexByHeader = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized && !indexByHeader.has(normalized)) indexByHeader.set(normalized, index);
  });
  return indexByHeader;
}

function normalizeProperties(row, indexByHeader) {
  const properties = {};

  for (const [property, header] of Object.entries(PROPERTY_COLUMNS)) {
    const raw = rowValue(row, indexByHeader, header);
    if (property === "speed") properties[property] = normalizeSpeed(raw);
    else if (property === "infractions") properties[property] = normalizeInfractions(raw);
    else if (DATE_PROPERTIES.has(property)) properties[property] = normalizeDate(raw);
    else properties[property] = cleanCell(raw);
  }

  return properties;
}

export function convertAnsvCsvToGeoJson(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      geojson: { type: "FeatureCollection", features: [] },
      skippedRows: 0,
    };
  }

  const [headers, ...records] = rows;
  const indexByHeader = createHeaderIndex(headers);
  const latitudeHeader = "latitud";
  const longitudeHeader = "longitud";

  if (!indexByHeader.has(latitudeHeader) || !indexByHeader.has(longitudeHeader)) {
    throw new Error("ANSV CSV must include Latitud and Longitud columns.");
  }

  const features = [];
  let skippedRows = 0;

  for (const row of records) {
    const lat = parseCoordinate(rowValue(row, indexByHeader, latitudeHeader));
    const lon = parseCoordinate(rowValue(row, indexByHeader, longitudeHeader));
    if (!isValidCoordinate(lon, lat)) {
      skippedRows += 1;
      continue;
    }

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: normalizeProperties(row, indexByHeader),
    });
  }

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    skippedRows,
  };
}

export async function buildAnsvCameraGeoJson({
  inputPath = DEFAULT_ANSV_CSV_PATH,
  outputPath = DEFAULT_ANSV_GEOJSON_PATH,
} = {}) {
  const csvText = await fs.readFile(inputPath, "utf8");
  const { geojson, skippedRows } = convertAnsvCsvToGeoJson(csvText);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(geojson, null, 4)}\n`);
  return {
    inputPath,
    outputPath,
    featureCount: geojson.features.length,
    skippedRows,
  };
}

function formatProjectPath(filePath) {
  return path.relative(projectRoot, filePath) || ".";
}

async function main() {
  const result = await buildAnsvCameraGeoJson();
  const skipped = result.skippedRows ? ` (${result.skippedRows} row(s) skipped)` : "";
  console.warn(
    `Prepared ${result.featureCount} ANSV camera feature(s)${skipped} -> ${formatProjectPath(result.outputPath)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

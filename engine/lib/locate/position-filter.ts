import { latLngToCell } from "h3-js";

// Ported from ov-dev's search-api. Positions become H3 resolution-5 cells,
// which filter the global Turbopuffer namespace on its h3_r5 attribute.
export type Position = { latitude: number; longitude: number };

export class PositionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionInputError";
  }
}

function coordinate(value: unknown, name: string, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new PositionInputError(`${name} must be a finite number from ${min} to ${max}.`);
  }
  return numberValue;
}

function isCoordinatePair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item !== "object");
}

function parseOne(value: unknown): Position {
  if (isCoordinatePair(value)) {
    return {
      latitude: coordinate(value[0], "latitude", -90, 90),
      longitude: coordinate(value[1], "longitude", -180, 180),
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PositionInputError("Each position must be [latitude, longitude] or { latitude, longitude }.");
  }
  const item = value as Record<string, unknown>;
  return {
    latitude: coordinate(item.latitude ?? item.lat, "latitude", -90, 90),
    longitude: coordinate(item.longitude ?? item.lng ?? item.lon, "longitude", -180, 180),
  };
}

export function parsePositions(value: unknown): Position[] {
  if (value === undefined || value === null || value === "") return [];
  if (value && typeof value === "object" && !Array.isArray(value) && "points" in value) {
    const points = (value as { points?: unknown }).points;
    if (!Array.isArray(points)) throw new PositionInputError("position.points must be an array of coordinate points.");
    return parsePositions(points);
  }
  const values = isCoordinatePair(value) ? [value] : Array.isArray(value) ? value : [value];
  if (values.length > 100) throw new PositionInputError("position supports at most 100 coordinates per request.");
  return values.map(parseOne);
}

export function positionsToH3R5(value: unknown) {
  return Array.from(new Set(parsePositions(value).map((position) =>
    latLngToCell(position.latitude, position.longitude, 5),
  )));
}

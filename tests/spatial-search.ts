import assert from "node:assert/strict";
import { cellAt } from "../engine/lib/locate/areas";
import { cellsAround, distance, executeSpatial, rankProximity } from "../engine/lib/locate/spatial-search";
import { parseSpatialPlan, spatialQuestions } from "../engine/lib/locate/spatial-plan";
import { shapeDiscover } from "../server/shape";
import { countReturned } from "../server/search";
import { cellToLatLng, gridDisk } from "h3-js";
const origin: [number, number] = [-80, 40];
const cell = cellAt(...origin);
const neighbor = gridDisk(cell, 1).find((item) => item !== cell)!;
const [lat, lng] = cellToLatLng(neighbor);
const other: [number, number] = [lng, lat];
const edge = distance(origin, other);
const row = (id: string, point: [number, number]) => ({
  type: "Feature", id, geometry: { type: "Point", coordinates: point }, properties: {},
});
assert.ok(cellsAround(origin, edge).includes(neighbor));
assert.ok(cellsAround([179.999, 0], 500).includes(cellAt(-179.999, 0)));
assert.deepEqual(rankProximity([row("b", other), row("a", other), row("a", other)], [origin], edge).map((item) => item.key), ["a", "b"]);
assert.deepEqual(rankProximity([row("a", other)], [origin], edge - 1), []);
for (const query of ["benches near libraries", "near libraries, find benches"]) {
  const spec = spatialQuestions(query, [{ id: "a", name: "Benches" }, { id: "b", name: "Libraries" }], [], { areaCount: 1, addressCount: 0, focus: false });
  const answers = { spatial_operation: { choice: "nearest" }, spatial_target: { choice: "artifact:a" }, spatial_reference: { choice: "artifact:b" } };
  assert.equal(parseSpatialPlan(answers, spec)?.operation, "nearest");
  assert.equal(parseSpatialPlan({ ...answers, spatial_reference: { choice: "artifact:unknown" } }, spec), null);
  assert.equal(parseSpatialPlan({ ...answers, spatial_reference: { choice: "area:2" } }, spec), null);
}
const region = { id: "1", name: "Test", region_type: "city" };
const ctx = {
  limit: 1, region, year: null, areas: [], addresses: [], targetFilters: [], referenceFilters: [],
  retrieve: async () => [], aggregate: async () => [{ cell, count: 1 }, { cell: neighbor, count: 30 }],
  artifactName: () => "Library", regionCenter: async () => origin,
};
const result = await executeSpatial({ operation: "density", target: "artifact:a" }, ctx);
assert.equal(result?.length, 1);
assert.match(result![0].properties.spatialInsight, /30 mapped records/);
assert.deepEqual(countReturned(result!), { locations: 0, areas: 1, units: 1 });
const publicResult = await shapeDiscover({ geojson: { features: result } });
assert.ok(publicResult.geojson.features[0].properties.outline);
assert.ok(!JSON.stringify(publicResult).includes(neighbor));
assert.ok(!JSON.stringify(publicResult).includes("spatial"));
console.log("Spatial routing, boundary coverage, deduplication, ordering, aggregation, privacy and usage assertions passed.");

import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import { circleLngLat, makeFrame, pointInRing, type LngLat } from "../geo/local";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DATA = `${import.meta.env.BASE_URL}data`;

export const COLORS = {
  context: "#c3c8d0",
  contextFallback: "#e1e4e8",
  contextOnPlot: "#e9d6c5",
  plotFill: "#b45309",
  plotLine: "#7c2d12",
  frontage: "#2563eb",
  station: "#0f766e",
};

export function createMap(container: string): MLMap {
  return new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [100.5654, 13.7304],
    zoom: 17.2,
    pitch: 58,
    bearing: -28,
    maxPitch: 75,
    canvasContextAttributes: { antialias: true },
    attributionControl: { compact: true },
  });
}

/** Hide the basemap's own 3D buildings: we draw OSM context ourselves (and avoid double extrusions). */
function hideStyleExtrusions(map: MLMap) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", "none");
  }
}

export interface ContextData {
  buildings: GeoJSON.FeatureCollection<GeoJSON.Polygon, { id: number; h: number; src: string; name: string }>;
  stations: GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; name_th: string; network: string }>;
}

export async function loadContext(): Promise<ContextData> {
  const [buildings, stations] = await Promise.all([
    fetch(`${DATA}/buildings.geojson`).then((r) => r.json()),
    fetch(`${DATA}/stations.geojson`).then((r) => r.json()),
  ]);
  return { buildings, stations };
}

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function addLayers(map: MLMap, ctx: ContextData) {
  hideStyleExtrusions(map);
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;

  // Station 500 m catchments (plan art. 37 measures from the platform; OSM gives the station node)
  const rings: GeoJSON.Feature[] = ctx.stations.features.map((s) => ({
    type: "Feature",
    properties: { name: s.properties.name },
    geometry: { type: "Polygon", coordinates: [circleLngLat(s.geometry.coordinates as LngLat, 500)] },
  }));
  map.addSource("station-rings", { type: "geojson", data: { type: "FeatureCollection", features: rings } });
  map.addLayer({
    id: "station-rings",
    type: "line",
    source: "station-rings",
    paint: { "line-color": COLORS.station, "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.55 },
  }, firstSymbol);

  map.addSource("plot", { type: "geojson", data: empty });
  map.addLayer({
    id: "plot-fill",
    type: "fill",
    source: "plot",
    paint: { "fill-color": COLORS.plotFill, "fill-opacity": 0.12 },
  }, firstSymbol);
  map.addLayer({
    id: "plot-line",
    type: "line",
    source: "plot",
    paint: { "line-color": COLORS.plotLine, "line-width": 2 },
  });

  map.addSource("frontage", { type: "geojson", data: empty });
  map.addLayer({
    id: "frontage-line",
    type: "line",
    source: "frontage",
    layout: { "line-cap": "round" },
    paint: { "line-color": COLORS.frontage, "line-width": 5 },
  });
  map.addLayer({
    id: "frontage-label",
    type: "symbol",
    source: "frontage",
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
      "text-offset": [0, -1.1],
    },
    paint: { "text-color": COLORS.frontage, "text-halo-color": "#fff", "text-halo-width": 1.6 },
  });

  // OSM context buildings, extruded. Buildings on the plot are shown as pale ghosts (to be demolished).
  map.addSource("context", { type: "geojson", data: ctx.buildings });
  map.addLayer({
    id: "context-3d",
    type: "fill-extrusion",
    source: "context",
    paint: {
      "fill-extrusion-color": [
        "case",
        ["==", ["get", "src"], "default"], COLORS.contextFallback,
        COLORS.context,
      ],
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.88,
      "fill-extrusion-vertical-gradient": true,
    },
  });

  // Existing buildings on the plot: separate translucent layer (filters set in showPlot).
  // Kept apart from the proposed envelope/schemes so no two extrusions ever share a face.
  map.addLayer({
    id: "context-onplot",
    type: "fill-extrusion",
    source: "context",
    filter: ["in", ["get", "id"], ["literal", [] as number[]]],
    paint: {
      "fill-extrusion-color": COLORS.contextOnPlot,
      "fill-extrusion-height": ["get", "h"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.22,
    },
  });

  map.addSource("stations", { type: "geojson", data: ctx.stations });
  map.addLayer({
    id: "stations",
    type: "symbol",
    source: "stations",
    layout: {
      "text-field": ["concat", "● ", ["get", "name"]],
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
      "text-anchor": "left",
      "text-allow-overlap": true,
    },
    paint: { "text-color": COLORS.station, "text-halo-color": "#fff", "text-halo-width": 1.8 },
  });
}

let onPlotIds: number[] = [];

/** Draw the plot outline and frontage edges; mark context buildings that sit on the plot. */
export function showPlot(
  map: MLMap,
  ctx: ContextData,
  coords: LngLat[],
  roads: { edge: number; row: number; name: string }[],
) {
  const ring = [...coords, coords[0]];
  (map.getSource("plot") as GeoJSONSource).setData({
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  });
  (map.getSource("frontage") as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: roads.map((r) => ({
      type: "Feature",
      properties: { label: `${r.name} · ROW ${r.row} m` },
      geometry: { type: "LineString", coordinates: [coords[r.edge], coords[(r.edge + 1) % coords.length]] },
    })),
  });

  const frame = makeFrame(coords[0]);
  const plotXY = coords.map(frame.toXY);
  onPlotIds = [];
  for (const b of ctx.buildings.features) {
    const r = b.geometry.coordinates[0];
    let cx = 0;
    let cy = 0;
    for (const p of r) {
      cx += p[0];
      cy += p[1];
    }
    const c = frame.toXY([cx / r.length, cy / r.length]);
    if (Math.abs(c[0]) > 2000 || Math.abs(c[1]) > 2000) continue;
    if (pointInRing(c, plotXY)) onPlotIds.push(b.properties.id);
  }
  const lit = ["literal", onPlotIds] as unknown as maplibregl.ExpressionSpecification;
  map.setFilter("context-3d", ["!", ["in", ["get", "id"], lit]]);
  map.setFilter("context-onplot", ["in", ["get", "id"], lit]);
  return onPlotIds.length;
}

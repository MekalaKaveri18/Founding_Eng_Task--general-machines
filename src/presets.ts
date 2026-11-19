import raw from "./presets.json";
import type { LngLat } from "./geo/local";

export type ZoneId = "Y8" | "Y9" | "Y10";

export interface RoadFrontage {
  /** Index of the plot edge (vertex i -> vertex i+1) that faces this road. */
  edge: number;
  /** Right-of-way width in metres (เขตทาง), boundary to boundary. */
  row: number;
  name: string;
}

export interface Preset {
  id: string;
  name: string;
  zone: ZoneId;
  note: string;
  roads: RoadFrontage[];
  /** Open ring (first vertex not repeated), WGS84. */
  coords: LngLat[];
}

export const PRESETS: Preset[] = (raw as unknown as Preset[]).map((p) => ({
  id: p.id,
  name: p.name,
  zone: p.zone,
  note: p.note,
  roads: p.roads,
  coords: p.coords,
}));

export const DEFAULT_PRESET = "soi22";

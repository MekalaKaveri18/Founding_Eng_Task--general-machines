/**
 * Rule parameters. Every value cites its source; see docs/research-notes.md.
 *  Plan   = Ministerial Regulation enforcing the Bangkok Comprehensive Plan B.E. 2556 (Gazette 130/41ก, 16 May 2013)
 *  MR 33  = Ministerial Regulation No. 33 (B.E. 2535), high-rise / extra-large buildings
 *  MR 55  = Ministerial Regulation No. 55 (B.E. 2543) as amended (MR 61, 66, 68)
 *  Ord 44 = Bangkok Building Control Ordinance B.E. 2544
 */
export type ZoneId = "Y8" | "Y9" | "Y10";
export type BuildingUse = "condo" | "rental" | "office" | "hotel";

export const FLOOR_H = 3.2; // assumed floor-to-floor height (m). Design assumption, not a legal figure.
export const HIGH_RISE_H = 23.0; // MR 33 art. 1: "high-rise" is >= 23.00 m
export const EXTRA_LARGE_GFA = 10_000; // MR 33 art. 1: "extra-large" is >= 10,000 m2
export const MIN_PLATE_M2 = 30; // below this a floor plate is not a usable floor (design assumption)

export interface ZoneParams {
  label: string;
  labelTh: string;
  far: number; // Plan arts. 15-17: max floor area ratio
  osr: number; // Plan arts. 15-17: min open space / total floor area
  article: string;
  purpose: string;
}

export const ZONES: Record<ZoneId, ZoneParams> = {
  Y8: {
    label: "ย.8", labelTh: "ที่อยู่อาศัยหนาแน่นมาก", far: 6, osr: 0.05, article: "Plan art. 15",
    purpose: "Inner city, scenery and natural environment protection",
  },
  Y9: {
    label: "ย.9", labelTh: "ที่อยู่อาศัยหนาแน่นมาก", far: 7, osr: 0.045, article: "Plan art. 16",
    purpose: "Inner city within the mass-transit service area",
  },
  Y10: {
    label: "ย.10", labelTh: "ที่อยู่อาศัยหนาแน่นมาก", far: 8, osr: 0.04, article: "Plan art. 17",
    purpose: "Inner city adjoining the central business district",
  },
};

export const MAX_FAR_HIGHRISE = 10; // MR 33 art. 5
export const MAX_BONUS = 0.2; // Plan art. 57: all FAR bonuses together <= 20 %
export const OPEN_SPACE_RESIDENTIAL = 0.3; // MR 33 art. 6(1); Ord 44 art. 52(1): of land area
export const OPEN_SPACE_OTHER = 0.1; // MR 33 art. 6(2); Ord 44 art. 52(2)
export const PERMEABLE_SHARE = 0.5; // Plan arts. 15-17: planting >= 50 % of the open space

// Boundary distances (m)
export const SIDE_LOWRISE = 3; // MR 55 art. 50(2): walls/balconies with openings, building 9 to < 23 m
export const SIDE_HIGHRISE = 6; // MR 33 art. 4: outermost edge, from neighbours' land AND from public roads
export const FIRE_ROAD_W = 6; // MR 33 art. 3: clear road all round the building
export const BETWEEN_BUILDINGS = 6; // MR 55 art. 48(1)(ค): two buildings 9-23 m on one plot, walls with openings

// Access (MR 33 art. 2)
export const HIGHRISE_FRONTAGE_LEN = 12;
export const HIGHRISE_ROAD_ROW = 10;
export const HIGHRISE_ROAD_ROW_BIG = 18; // when total floor area > 30,000 m2
export const BIG_GFA = 30_000;

// Height plane (MR 55 art. 44, Ord 44 art. 49): height <= 2 x horizontal distance to the opposite road boundary
export const HEIGHT_PLANE_RATIO = 2;
export const CORNER_OR_THROUGH_MAX_SPAN = 60; // MR 55 arts. 45-46: span limit for using the wider road

// Front open space (Ord 44 art. 52(6)): > 3 storeys
export const FRONT_SPACE_W = 12;
export const FRONT_SPACE_PERIMETER_SHARE = 1 / 6;

// Parking (Ord 44 arts. 83-88; MR 7 as amended by MR 64)
export const PARKING_AREA_PER_BAY = 30; // gross incl. aisle share (design assumption)
export const BAY_W = 2.4;
export const BAY_L = 5.0;
export const AISLE_W = 6.0;

export function roadSetbackFromBoundary(row: number): number {
  // MR 55 art. 41 / Ord 44 art. 50, for buildings over 2 storeys or 8 m.
  if (row < 10) return Math.max(0, 6 - row / 2); // 6 m from the road centreline
  if (row <= 20) return row / 10; // 1/10 of the road width from the road boundary
  return 2;
}

export const BONUS_ENERGY: Record<0 | 1 | 2 | 3 | 4, number> = { 0: 0, 1: 0.05, 2: 0.1, 3: 0.15, 4: 0.2 }; // Plan art. 56
export const BONUS_WATER_PER_UNIT = 0.05; // Plan art. 55: 1 m3 per 50 m2 of land = 5 %

// Design assumptions (not legal figures). Shown in the UI and the write-up.
export const NET_EFFICIENCY = 0.78; // net saleable area as a share of residential gross area
export const AVG_UNIT: Record<BuildingUse, number> = { condo: 45, rental: 32, hotel: 32, office: 0 }; // net m2 per unit / room
export const SHARE_UNITS_60: Record<BuildingUse, number> = { condo: 0.4, rental: 0, hotel: 0, office: 0 }; // share of units of 60 m2 or more
export const HOTEL_ROOMS_RESTRICTED = 50; // Plan art. 15(8): more than 50 rooms is prohibited unless the plot qualifies

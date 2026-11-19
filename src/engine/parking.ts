import { PARKING_AREA_PER_BAY, type BuildingUse } from "./constants";

/**
 * Required car spaces in Bangkok. Ord 44 arts. 83-85 and MR 7 art. 3(1) as amended by MR 64.
 *
 * Interpretation (stated in the write-up): a condo or hotel tower is a "large building"
 * (> 2,000 m2, or >= 15 m and > 1,000 m2), so the greater of the per-use rate and
 * 1 space per 120 m2 of building floor area applies (Ord 44 art. 84(16)). The 1:120 test is run
 * on floor area excluding the car park itself, otherwise the rule would be circular.
 */
export interface ParkingInput {
  use: BuildingUse;
  /** Floor area excluding parking floors (m2). */
  gfaExParking: number;
  /** Condo / rental: number of units of 60 m2 or more (each needs 1 space, Ord 84(3)). */
  units60: number;
  /** Hotel: number of rooms. */
  rooms: number;
}

export interface ParkingResult {
  required: number;
  perUse: number;
  largeBuilding: number;
  basis: string;
}

export function hotelSpaces(rooms: number): number {
  // Ord 44 art. 84(2)
  if (rooms <= 0) return 0;
  if (rooms <= 100) return Math.max(10, 10 + Math.ceil(Math.max(0, rooms - 30) / 5));
  return 10 + Math.ceil(70 / 5) + Math.ceil((rooms - 100) / 10);
}

export function parkingRequired(i: ParkingInput): ParkingResult {
  const largeBuilding = Math.ceil(i.gfaExParking / 120);
  let perUse = 0;
  let basis = "";
  switch (i.use) {
    case "condo":
    case "rental":
      perUse = i.units60; // Ord 84(3): 1 per unit (units of 60 m2 or more)
      basis = "max(1 per unit >= 60 m², 1 per 120 m²) · Ord 44 art. 84(3), (16)";
      break;
    case "office":
      perUse = Math.ceil(i.gfaExParking / 60); // Ord 84(6)
      basis = "max(1 per 60 m², 1 per 120 m²) · Ord 44 art. 84(6), (16)";
      break;
    case "hotel":
      perUse = hotelSpaces(i.rooms); // Ord 84(2)
      basis = "max(hotel rate by rooms, 1 per 120 m²) · Ord 44 art. 84(2), (16)";
      break;
  }
  return { required: Math.max(perUse, largeBuilding), perUse, largeBuilding, basis };
}

/** Gross floor area a car park of n spaces takes, including aisle share and ramps (assumption, see constants). */
export function parkingArea(spaces: number): number {
  return spaces * PARKING_AREA_PER_BAY;
}

/**
 * Synthetic-traffic placement around a real anchor.
 *
 * Backend trajectories are local nautical-mile offsets (east, north). They
 * are projected to latitude/longitude with a local equirectangular
 * conversion around San Francisco International Airport:
 *
 *   latitude  = anchor.lat + north_nm / 60
 *   longitude = anchor.lng + east_nm / (60 * cos(anchor latitude))
 *
 * This changes only the display projection. Backend geometry, separation
 * math, and safety calculations are untouched. All traffic stays synthetic.
 */

/** SFO anchor for the simulated terminal area. */
export const SFO_ANCHOR = { lat: 37.6213, lng: -122.379 } as const;

export interface LatLng {
  lat: number;
  lng: number;
}

export function nmToLatLng(
  eastNm: number,
  northNm: number,
  anchor: LatLng = SFO_ANCHOR,
): LatLng {
  return {
    lat: anchor.lat + northNm / 60,
    lng: anchor.lng + eastNm / (60 * Math.cos((anchor.lat * Math.PI) / 180)),
  };
}

/** Display-only lateral separation between overlapping route lines (NM). */
export const ROUTE_DISPLAY_OFFSET_NM = 0.9;

/**
 * Backend route longitude runs 0–60 NM with PONCT at x=60. For display only,
 * the terminal end (PONCT, x=60) is anchored at SFO so the synthetic traffic
 * reads as an arrival from the west. Backend coordinates and all safety
 * math are untouched.
 */
export const ROUTE_END_NM = 60;

export function scenarioNmToLatLng(
  xNm: number,
  yNm: number,
  anchor: LatLng = SFO_ANCHOR,
): LatLng {
  return nmToLatLng(xNm - ROUTE_END_NM, yNm, anchor);
}
